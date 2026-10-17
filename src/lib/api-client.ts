"use client";
// The only way client code should call our JSON API or server actions. It logs the call, pulls
// `_debug` lines into the drawer (before the "response" line, so order reads naturally),
// and turns every failure into an ApiError with a code the UI can show.

import { createLogger } from "./client-log";
import { pushEntries } from "./debug-store";
import { type ErrorCode, isErrorCode } from "./errors";

const log = createLogger("api");

export class ApiError extends Error {
  code: ErrorCode;
  status: number;
  reqId: string | null;
  constructor(code: ErrorCode, message: string, status: number, reqId: string | null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.reqId = reqId;
  }
}

export async function apiFetch<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T & { reqId?: string }> {
  const method = init?.method ?? "GET";
  const t0 = performance.now();
  log.debug(`${method} ${url} start`);

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { accept: "application/json", ...init?.headers } });
  } catch (err) {
    log.error(`${method} ${url} network failure`, { err, ms: Math.round(performance.now() - t0) });
    throw new ApiError("NETWORK", "The server could not be reached.", 0, null);
  }

  const reqId = res.headers.get("x-request-id");
  const rlog = reqId ? log.forRequest(reqId) : log;
  const ms = Math.round(performance.now() - t0);

  let body: (T & { _debug?: string[]; ok?: boolean; error?: { code?: string; message?: string } }) | null = null;
  try {
    body = await res.json();
  } catch (err) {
    rlog.error(`${method} ${url} returned non-JSON`, { status: res.status, ms, err });
    throw new ApiError("BAD_RESPONSE", "The server sent a response we could not read.", res.status, reqId);
  }

  if (body && Array.isArray(body._debug)) {
    pushEntries("server", body._debug);
  } else {
    rlog.trace("no _debug lines in response", { reason: "production and not an admin, or endpoint returned none" });
  }

  if (!res.ok || body?.ok === false) {
    const code = isErrorCode(body?.error?.code) ? body.error.code : "UNKNOWN";
    rlog.error(`${method} ${url} failed ${res.status} ${code} in ${ms}ms`, { message: body?.error?.message });
    throw new ApiError(code, body?.error?.message ?? "Request failed.", res.status, reqId);
  }

  rlog.debug(`${method} ${url} ${res.status} in ${ms}ms`);
  if (body) delete body._debug;
  return body as T & { reqId?: string };
}

/** Call a server action wrapped with withAction, ingesting its `_debug` lines. */
export async function runAction<I, O>(
  name: string,
  action: (input: I) => Promise<
    { ok: true; data: O; reqId: string; _debug?: string[] } | { ok: false; code: ErrorCode; message: string; reqId: string; _debug?: string[] }
  >,
  input: I,
): Promise<O> {
  const t0 = performance.now();
  log.debug(`action ${name} start`);
  let result;
  try {
    result = await action(input);
  } catch (err) {
    log.error(`action ${name} threw before returning a result`, { err });
    throw new ApiError("NETWORK", "The server could not be reached.", 0, null);
  }
  if (result._debug) pushEntries("server", result._debug);
  const alog = log.forRequest(result.reqId);
  const ms = Math.round(performance.now() - t0);
  if (!result.ok) {
    alog.error(`action ${name} failed ${result.code} in ${ms}ms`, { message: result.message });
    throw new ApiError(result.code, result.message, 500, result.reqId);
  }
  alog.debug(`action ${name} ok in ${ms}ms`);
  return result.data;
}
