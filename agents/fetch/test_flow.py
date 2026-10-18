"""End-to-end check of the chat workflow against a running Altostratus (no Agentverse needed).

    cd agents/fetch && .venv/bin/python test_flow.py [base_url]

Plays one ASI:One sender through: describe -> review card -> find a person -> carousel ->
choose (card JSON) -> draft review card -> "I sent it" (planner prose). Then the recovery paths:
an ask deleted mid-conversation (demo reset) and an unreachable server. Exits non-zero on failure.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import uuid
from pathlib import Path

from dotenv import load_dotenv

from altostratus_client import AltostratusClient
from conversation import Conversation

load_dotenv(Path(__file__).parent / ".env")
logging.basicConfig(level="INFO", format="[%(name)s] %(levelname)s %(message)s")
BASE = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("ALTOSTRATUS_BASE_URL", "http://localhost:3000")
TOKEN = os.environ["AGENT_API_TOKEN"]


class DictStore(dict):
    def set(self, k, v):
        self[k] = v


def show(step: str, replies) -> None:
    print(f"\n===== {step}")
    for r in replies:
        print(r.text[:900])
        if r.card:
            md = r.card.metadata()
            payload = json.loads(md["card_payload"])
            print(f"  [card {md['card_kind']}, {len(md['card_payload'])} bytes, keys {sorted(payload)}]")


def expect(cond: bool, what: str) -> None:
    if not cond:
        print(f"FAIL: {what}")
        sys.exit(1)
    print(f"ok: {what}")


async def main() -> None:
    client = AltostratusClient(BASE, TOKEN)
    store = DictStore()
    conv = Conversation(client, store)
    sender = f"agent1qtest{uuid.uuid4().hex[:24]}"
    lines: list[str] = []

    async def progress(line: str) -> None:
        lines.append(line)

    r = await conv.handle(sender, "Paperboy emailed the same invoice twice to a shipper this morning after the till retried a charge. Who owns this?", progress)
    show("describe", r)
    expect(r[0].card is not None and r[0].card.kind in ("review", "detail"), "understanding comes back as a review or detail card")
    expect("invoice-worker" in r[0].text, "the glossary read Paperboy as invoice-worker")

    r = await conv.handle(sender, json.dumps(r[0].card.payload.get("approve_cta", r[0].card.payload.get("ctas", [{}])[0])["selection"]), progress)
    show("find a person (card click)", r)
    card = r[0].card
    expect(card is not None and card.kind == "carousel" and len(card.payload["items"]) >= 3, "shortlist comes back as a carousel with 3+ people")
    pick = card.payload["items"][0]["primary_cta"]["selection"]

    r = await conv.handle(sender, json.dumps(pick), progress)
    show("choose (card click)", r)
    expect(r[0].card is not None and r[0].card.kind == "review" and "```" in r[0].text, "draft comes back as text plus a review card")

    r = await conv.handle(sender, "short", progress)
    show("other version", r)
    expect("Short" in r[0].text or "short" in r[0].text.lower(), "the short version can be shown")

    sel = r[0].card.payload["approve_cta"]["selection"]
    prose = f"The user confirmed they sent the message for ask {sel['ask_id']} (action sent, variant {sel['variant']})."
    r = await conv.handle(sender, prose, progress)
    show("I sent it (planner prose)", r)
    expect(r[0].text.startswith("Recorded: you sent it"), "the send is recorded from planner prose")

    # Recovery 1: the ask disappears (Reset demo deletes visitor asks). The agent re-creates it.
    r = await conv.handle(sender, "My kubectl apply to the yard cluster fails with OOMKilled on every pod since this morning.", progress)
    show("second problem", r)
    session = store[f"session:{sender}"]
    old = session["ask_id"]
    session["ask_id"] = "ask_999999999"  # gone, like after a reset
    r = await conv.handle(sender, "find a person", progress)
    show("find a person on a deleted ask", r)
    expect(store[f"session:{sender}"]["ask_id"] not in (old, "ask_999999999"), "a missing ask was re-created from the stored text")

    # Recovery 2: the app is unreachable. Three attempts, then a plain message; the session is kept.
    dead = Conversation(AltostratusClient("http://127.0.0.1:9", TOKEN, base_delay=0.05), store)
    r = await dead.handle(sender, "status", progress)
    show("unreachable server", r)
    expect("could not reach Altostratus" in r[0].text, "network failure is reported plainly after retries")

    print(f"\nprogress lines sent along the way: {lines}")
    await client.close()
    print("\nALL OK")


asyncio.run(main())
