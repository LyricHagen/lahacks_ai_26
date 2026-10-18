"""Altostratus on ASI:One: a uAgent implementing the Agent Chat Protocol.

Run it (see README.md):

    cd agents/fetch && .venv/bin/python agent.py

It connects to Agentverse through a mailbox (no public endpoint needed), publishes its manifest so
ASI:One can discover it, and answers chat messages by driving the Altostratus web app's API
(conversation.py, altostratus_client.py). Interactive Cards carry the review screen, the shortlist
carousel and the draft review; every card message also has a plain text version, so a client that
cannot render a card still shows the whole workflow.

Environment (agents/fetch/.env, never committed):
    AGENT_SEED              secret seed phrase; the agent address is derived from it
    ALTOSTRATUS_BASE_URL    the deployed app, e.g. https://altostratus.vercel.app (no trailing slash)
    AGENT_API_TOKEN         same value as the app's AGENT_API_TOKEN (FEATURE_FETCH_AGENT=1 on the app)
    AGENT_PORT              local port for the agent server and inspector, default 8001
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    MetadataContent,
    StartSessionContent,
    TextContent,
    chat_protocol_spec,
)

from altostratus_client import AltostratusClient, short
from conversation import Conversation, Reply

HERE = Path(__file__).parent
load_dotenv(HERE / ".env")

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="[%(asctime)s] [%(name)s] %(levelname)s %(message)s")
log = logging.getLogger("altostratus.agent")

SEED = os.environ.get("AGENT_SEED")
BASE_URL = os.environ.get("ALTOSTRATUS_BASE_URL", "http://localhost:3000")
TOKEN = os.environ.get("AGENT_API_TOKEN", "")
if not SEED or not TOKEN:
    raise SystemExit("Set AGENT_SEED and AGENT_API_TOKEN in agents/fetch/.env (see README.md).")

agent = Agent(
    name="altostratus",
    seed=SEED,
    port=int(os.environ.get("AGENT_PORT", "8001")),
    mailbox=True,
    publish_agent_details=True,
    readme_path=str(HERE / "README.md"),
    description="Finds the right colleague for a new hire's question, says why, checks when they are free and drafts the message. The person always sends it themselves.",
    handle_messages_concurrently=True,
)

client = AltostratusClient(BASE_URL, TOKEN)
chat = Protocol(spec=chat_protocol_spec)


class StorageStore:
    """Session state per ASI:One sender in the agent's own key-value storage."""

    def __init__(self, ctx: Context) -> None:
        self.ctx = ctx

    def get(self, key: str):
        return self.ctx.storage.get(key)

    def set(self, key: str, value) -> None:
        self.ctx.storage.set(key, value)


def to_message(r: Reply, end: bool = False) -> ChatMessage:
    content: list = [TextContent(text=r.text)]
    if r.card:
        content.append(MetadataContent(metadata=r.card.metadata()))
    if end:
        content.append(EndSessionContent())
    return ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=content)


@chat.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id))
    text = " ".join(c.text for c in msg.content if isinstance(c, TextContent)).strip()
    # ASI:One keeps an @mention of the agent in the text; it is not part of the problem.
    text = re.sub(r"@agent1[a-z0-9]+[:,]?\s*", "", text).strip()
    if any(isinstance(c, StartSessionContent) for c in msg.content):
        log.info("session started by %s", short(sender))
        if not text:
            await ctx.send(sender, to_message(Reply("Hi, I am Altostratus. Describe what you are stuck on at work, the way you would tell a teammate, and I will find the right colleague, say why, check when they are free and draft the message. You always send it yourself.")))
            return
    if not text:
        log.info("message from %s has no text content (%s), ignored", short(sender), [type(c).__name__ for c in msg.content])
        return
    log.info("message from %s: %s chars", short(sender), len(text))

    async def progress(line: str) -> None:
        await ctx.send(sender, to_message(Reply(f"_{line}_")))

    conv = Conversation(client, StorageStore(ctx))
    try:
        replies = await conv.handle(sender, text, progress)
    except Exception as e:  # last line of defence: never leave the person without an answer
        log.exception("unhandled error for %s", short(sender))
        replies = [Reply(f"Something went wrong on my side ({type(e).__name__}). Send that again, or reply **start over**.")]
    for r in replies:
        await ctx.send(sender, to_message(r))
    log.info("answered %s with %s message(s), cards: %s", short(sender), len(replies), [r.card.kind for r in replies if r.card])


@chat.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    log.debug("ack from %s for %s", short(sender), msg.acknowledged_msg_id)


agent.include(chat, publish_manifest=True)


@agent.on_event("startup")
async def startup(ctx: Context):
    log.info("Altostratus agent %s up; calling %s; chat protocol %s %s", agent.address, BASE_URL, chat_protocol_spec.name, chat_protocol_spec.version)


@agent.on_event("shutdown")
async def shutdown(ctx: Context):
    await client.close()


if __name__ == "__main__":
    agent.run()
