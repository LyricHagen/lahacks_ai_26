"""HTTP client for the Altostratus agent API (src/app/api/agent/* and src/app/api/asks/*).

The agent never reimplements the product: every step is a call to the web app, which runs the
same functions as its own UI. This module owns reliability for those calls:

  * every request is logged (method, path, status, ms, attempt, the app's request id),
  * network errors, timeouts, 429 and 5xx are retried up to 3 attempts with exponential backoff
    (Retry-After is honoured up to 5 s),
  * 4xx answers are not retried; they become ApiError with the app's error code so the agent can
    recover by meaning (ASK_NOT_FOUND, ASK_STATE_CONFLICT, RATE_LIMITED, ...),
  * a pipeline run that finds another run in progress waits for it by polling the status route.

Identity: the bearer AGENT_API_TOKEN plus the ASI:One sender address. The app derives the
signed-out visitor this sender acts as from both (visitor_id_for, mirrored in src/lib/agent-api.ts).
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from dataclasses import dataclass
from typing import Any

import aiohttp

log = logging.getLogger("altostratus.client")

RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}


def visitor_id_for(token: str, sender: str) -> str:
    """Same derivation as visitorIdFor in src/lib/agent-api.ts."""
    return "vis_" + hashlib.sha256(f"{token}:{sender}".encode()).hexdigest()[:16]


def short(sender: str) -> str:
    return f"{sender[:10]}...{sender[-4:]}" if len(sender) > 16 else sender


@dataclass
class ApiError(Exception):
    code: str
    message: str
    status: int
    req_id: str | None = None

    def __str__(self) -> str:  # pragma: no cover - log formatting only
        return f"{self.code} ({self.status}): {self.message} [req {self.req_id or 'none'}]"


class AltostratusClient:
    def __init__(self, base_url: str, token: str, *, attempts: int = 3, base_delay: float = 0.6) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.attempts = attempts
        self.base_delay = base_delay
        self._session: aiohttp.ClientSession | None = None

    async def _http(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    async def call(self, method: str, path: str, sender: str, body: dict[str, Any] | None = None, timeout: float = 30.0) -> dict[str, Any]:
        headers = {
            "authorization": f"Bearer {self.token}",
            "x-agent-sender": sender,
            "cookie": f"w2a_visitor={visitor_id_for(self.token, sender)}",
            "accept": "application/json",
        }
        url = f"{self.base_url}{path}"
        last: Exception | None = None
        for attempt in range(1, self.attempts + 1):
            t0 = time.perf_counter()
            try:
                http = await self._http()
                async with http.request(method, url, json=body, headers=headers, timeout=aiohttp.ClientTimeout(total=timeout)) as res:
                    ms = round((time.perf_counter() - t0) * 1000)
                    try:
                        data = await res.json(content_type=None)
                    except Exception:  # not JSON: a proxy error page, a crash
                        data = {"ok": False, "error": {"code": "BAD_RESPONSE", "message": (await res.text())[:200]}}
                    req_id = data.get("reqId") if isinstance(data, dict) else None
                    log.info("%s %s -> %s in %sms (attempt %s/%s, app req %s, sender %s)", method, path, res.status, ms, attempt, self.attempts, req_id, short(sender))
                    if res.status < 400:
                        return data
                    err = (data.get("error") or {}) if isinstance(data, dict) else {}
                    api_err = ApiError(err.get("code", "UNKNOWN"), err.get("message", "request failed"), res.status, req_id)
                    if res.status in RETRYABLE_STATUS and attempt < self.attempts:
                        delay = self._delay(attempt, res.headers.get("retry-after"))
                        log.warning("%s %s answered %s %s, retrying in %.1fs", method, path, res.status, api_err.code, delay)
                        last = api_err
                        await asyncio.sleep(delay)
                        continue
                    raise api_err
            except ApiError:
                raise
            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                ms = round((time.perf_counter() - t0) * 1000)
                last = e
                if attempt < self.attempts:
                    delay = self._delay(attempt, None)
                    log.warning("%s %s failed after %sms (%s: %s), attempt %s/%s, retrying in %.1fs", method, path, ms, type(e).__name__, e, attempt, self.attempts, delay)
                    await asyncio.sleep(delay)
                    continue
                log.error("%s %s failed after %s attempts: %s", method, path, self.attempts, e)
                raise ApiError("NETWORK", f"Altostratus did not answer ({type(e).__name__}).", 0) from e
        raise ApiError("NETWORK", f"Altostratus did not answer ({last}).", 0)

    def _delay(self, attempt: int, retry_after: str | None) -> float:
        if retry_after:
            try:
                return min(5.0, max(0.2, float(retry_after)))
            except ValueError:
                pass
        return self.base_delay * (2 ** (attempt - 1))

    # -- the product, step by step --------------------------------------------------------------

    async def create_ask(self, sender: str, body: str, urgency: str | None = None) -> str:
        payload: dict[str, Any] = {"body": body}
        if urgency:
            payload["urgency"] = urgency
        r = await self.call("POST", "/api/agent/asks", sender, payload)
        return r["askId"]

    async def view(self, sender: str, ask_id: str) -> dict[str, Any]:
        return (await self.call("GET", f"/api/agent/asks/{ask_id}", sender))["ask"]

    async def confirm(self, sender: str, ask_id: str, answered_by_doc_id: str | None = None) -> dict[str, Any]:
        return await self.call("POST", f"/api/agent/asks/{ask_id}/confirm", sender, {"answeredByDocId": answered_by_doc_id})

    async def choose(self, sender: str, ask_id: str, employee_id: str) -> dict[str, Any]:
        return await self.call("POST", f"/api/agent/asks/{ask_id}/choose", sender, {"employeeId": employee_id})

    async def sent(self, sender: str, ask_id: str, variant: str) -> dict[str, Any]:
        return (await self.call("POST", f"/api/agent/asks/{ask_id}/sent", sender, {"variant": variant}))["result"]

    async def run(self, sender: str, ask_id: str) -> dict[str, Any]:
        """Run the processing steps until the ask needs the person again. Recovers from a held lease and one failed step."""
        r = await self.call("POST", f"/api/asks/{ask_id}/run", sender, {}, timeout=120.0)
        if r.get("stoppedBecause") == "already running":
            log.info("%s is already running elsewhere, polling its status", ask_id)
            r = await self._wait_not_running(sender, ask_id)
        if r.get("state") == "draft" and "failed" in str(r.get("stoppedBecause", "")):
            log.warning("%s step failed (%s), submitting it again once", ask_id, r.get("stoppedBecause"))
            await self.call("POST", f"/api/agent/asks/{ask_id}/retry", sender, {})
            r = await self.call("POST", f"/api/asks/{ask_id}/run", sender, {}, timeout=120.0)
            if r.get("state") == "draft":
                raise ApiError("ASK_STEP_FAILED", f"The {ask_id} pipeline failed twice ({r.get('stoppedBecause')}).", 500, r.get("reqId"))
        return r

    async def _wait_not_running(self, sender: str, ask_id: str, limit_s: float = 90.0) -> dict[str, Any]:
        t0 = time.perf_counter()
        while time.perf_counter() - t0 < limit_s:
            await asyncio.sleep(1.5)
            s = await self.call("GET", f"/api/asks/{ask_id}", sender)
            if not s.get("running"):
                return {"askId": ask_id, "state": s.get("state"), "stoppedBecause": "the other run finished"}
        raise ApiError("ASK_STATE_CONFLICT", f"{ask_id} is still being processed after {limit_s:.0f}s.", 409)
