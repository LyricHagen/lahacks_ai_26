"""The Altostratus conversation, independent of uAgents so it can be tested against the app directly.

One ASI:One sender is one Altostratus signed-out visitor (demo mode). The whole primary workflow
runs in the chat:

  1. describe the problem          -> create the ask, run understanding, show what was understood
                                       and any document that may already answer it (review/detail card)
  2. "Find a person" / doc answered -> confirm, run retrieval and ranking, show the shortlist with a
                                       reason per person (carousel card), the why-not and fairness rules
  3. pick a person                  -> choose, run drafting, show the draft (review card)
  4. "I sent it"                    -> record the send (the person sends it themselves; nothing is sent here)

Card clicks come back as text: a JSON object (direct) or a sentence from the ASI:One planner that
repeats every identifier. parse_intent() handles both, plus plain typed commands.

Recovery: every app call goes through AltostratusClient (retries). On top of that, by meaning:
ASK_NOT_FOUND (a demo reset deleted the ask) re-creates it from the stored text once;
ASK_STATE_CONFLICT re-reads the ask and continues from its real state; anything else is reported
with its code and request id, and the session keeps its place so the person can try again.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Protocol

from altostratus_client import AltostratusClient, ApiError, short

log = logging.getLogger("altostratus.chat")

VARIANTS = ("short", "full", "call")


@dataclass
class Card:
    kind: str  # carousel | detail | form | review
    payload: dict[str, Any]
    requires_interaction: bool = True

    def metadata(self) -> dict[str, str]:
        return {
            "card_protocol_version": "1",
            "requires_card_interaction": "true" if self.requires_interaction else "false",
            "card_kind": self.kind,
            "card_payload": json.dumps(self.payload, ensure_ascii=False),
            **({} if self.requires_interaction else {"is_terminal": "true"}),
        }


@dataclass
class Reply:
    text: str
    card: Card | None = None


class Store(Protocol):
    def get(self, key: str) -> Any: ...
    def set(self, key: str, value: Any) -> None: ...


@dataclass
class Session:
    ask_id: str | None = None
    stage: str = "idle"  # idle | confirming | shortlist | ready | done
    last_text: str | None = None
    shortlist: list[dict[str, str]] = field(default_factory=list)  # [{id, name}]
    variant: str | None = None

    @staticmethod
    def load(store: Store, sender: str) -> "Session":
        raw = store.get(f"session:{sender}")
        return Session(**raw) if isinstance(raw, dict) else Session()

    def save(self, store: Store, sender: str) -> None:
        store.set(f"session:{sender}", self.__dict__)


# -------------------------------------------------------------------------------------------------
# intent
# -------------------------------------------------------------------------------------------------


def parse_intent(text: str, session: Session) -> dict[str, Any]:
    """Card selection (JSON or planner prose) or a typed command. Falls back to a new problem."""
    t = text.strip()
    try:
        obj = json.loads(t)
        if isinstance(obj, dict) and obj.get("action"):
            return obj
    except (ValueError, TypeError):
        pass
    low = t.lower()
    m_ask = re.search(r"\bask_\d+\b", t)
    ask_id = m_ask[0] if m_ask else session.ask_id
    emp = re.search(r"\bemp_\d+\b", t)
    doc = re.search(r"\bdoc_[a-z0-9_]+\b", t)
    if re.fullmatch(r"(start over|new ask|reset|restart|cancel)[.!]?", low):
        return {"action": "start_over"}
    if low in {"status", "where are we", "what now", "help"}:
        return {"action": "status", "ask_id": ask_id}
    if "doc_answered" in low or (doc and re.search(r"\banswer", low)) or (session.stage == "confirming" and re.search(r"\b(doc|document|runbook)\b.*\banswer|\banswered\b", low)):
        return {"action": "doc_answered", "ask_id": ask_id, "doc_id": doc[0] if doc else None}
    if "find_person" in low or re.search(r"\bfind (a |the )?(person|people|someone)\b|\bfind people\b", low):
        return {"action": "find_person", "ask_id": ask_id}
    if emp:
        return {"action": "choose", "ask_id": ask_id, "employee_id": emp[0]}
    if session.stage == "shortlist":
        m = re.fullmatch(r"#?([1-5])", low)
        if m and len(session.shortlist) >= int(m[1]):
            return {"action": "choose", "ask_id": ask_id, "employee_id": session.shortlist[int(m[1]) - 1]["id"]}
        for p in session.shortlist:
            first = p["name"].split()[0].lower()
            if re.search(rf"\b{re.escape(first)}\b", low) and len(low) < 60:
                return {"action": "choose", "ask_id": ask_id, "employee_id": p["id"]}
    if session.stage == "ready":
        if "not_yet" in low or re.search(r"\bnot (sent )?yet\b", low):
            return {"action": "not_yet", "ask_id": ask_id}
        for v in VARIANTS:
            if re.fullmatch(rf"(show )?(the )?{v}( version| one)?", low):
                return {"action": "show_variant", "ask_id": ask_id, "variant": v}
        if re.search(r"\baction:? \"?sent\b", low) or (re.search(r"\b(i )?(sent|have sent|sent it|done)\b", low) and len(low) < 80):
            v = next((v for v in VARIANTS if re.search(rf"\b{v}\b", low)), None)
            return {"action": "sent", "ask_id": ask_id, "variant": v or session.variant}
    return {"action": "new_problem", "text": t}


# -------------------------------------------------------------------------------------------------
# rendering
# -------------------------------------------------------------------------------------------------


def _clip(s: str | None, n: int) -> str:
    s = (s or "").strip()
    return s if len(s) <= n else s[: n - 3].rstrip() + "..."


def render_understanding(a: dict[str, Any]) -> Reply:
    u = a.get("understanding") or {}
    lines = [f"**What I understood** ({a['askId']}): {u.get('restatement', '')}"]
    if u.get("services"):
        lines.append(f"Services: {', '.join(u['services'])}")
    if u.get("skills"):
        lines.append(f"Skills: {', '.join(u['skills'])}")
    g = u.get("glossary")
    if g and g.get("hits"):
        lines.append("Company terms: " + "; ".join(f"\"{h['phrase']}\" means {h['means']}" for h in g["hits"]))
    if u.get("keptOut"):
        lines.append(f"{u['keptOut']} sensitive detail(s) will be kept out of any message.")
    rows = [{"label": "Problem", "value": _clip(u.get("restatement"), 160)}, {"label": "Services", "value": ", ".join(u.get("services") or []) or "none named"}, {"label": "Skills", "value": ", ".join(u.get("skills") or []) or "none"}]
    if g and g.get("hits"):
        rows.append({"label": "Company terms", "value": _clip("; ".join(f"{h['phrase']}: {h['means']}" for h in g["hits"]), 200)})
    docs = a.get("docs") or []
    if docs:
        d = docs[0]
        lines.append("")
        lines.append(f"**This document may already answer it:** {d['title']} ({d['link']})")
        lines.append(f"> {_clip(d['quote'], 500)}")
        lines.append("")
        lines.append("Reply **the doc answered it**, or **find a person**.")
        rows.append({"label": "Document", "value": _clip(d["title"], 120)})
        card = Card(
            "detail",
            {
                "title": "Before asking a person: this may already answer it",
                "summary_rows": rows + [{"label": "Quote", "value": _clip(d["quote"], 300)}],
                "ctas": [
                    {"label": "Find a person", "selection": {"action": "find_person", "ask_id": a["askId"]}, "primary": True},
                    {"label": "The doc answered it", "selection": {"action": "doc_answered", "ask_id": a["askId"], "doc_id": d["documentId"]}},
                ],
            },
        )
    else:
        lines.append("")
        lines.append("No runbook covers it closely. Reply **find a person** to see who to ask, or **start over** to rephrase.")
        card = Card(
            "review",
            {
                "title": "Is this what you need help with?",
                "summary_rows": rows,
                "approve_cta": {"label": "Find a person", "selection": {"action": "find_person", "ask_id": a["askId"]}, "primary": True},
                "reject_cta": {"label": "Start over", "selection": {"action": "start_over"}},
            },
        )
    if u.get("note"):
        lines.append(f"_{u['note']}_")
    return Reply("\n".join(lines), card)


def render_shortlist(a: dict[str, Any]) -> Reply:
    people = a.get("shortlist") or []
    if not people:
        return Reply(f"Nobody matched {a['askId']} closely enough to suggest. Reply **start over** to describe it differently, or open {a['web']}.")
    lines = [f"**Who to ask** about {a['askId']}:"]
    for p in people:
        lines.append(f"{p['rank']}. **{p['name']}**, {p['title']} ({p['team']}). {p.get('reason') or ''} Next free: {p.get('nextWindow') or 'not in the next two weeks'}. {p['load']}.")
    if a.get("whyNot"):
        lines.append(f"\nWhy not someone else: {a['whyNot']}")
    for g in a.get("guardrailsFired") or []:
        lines.append(f"Fairness rule {g['rule']}: {g['summary']}")
    lines.append("\nReply with a number or a first name to draft a message to them.")
    items = []
    for p in people:
        first = p["name"].split()[0]
        badges = [{"label": p["load"], "variant": "info"}]
        if p.get("owns"):
            badges.append({"label": f"owns {p['owns'][0]}", "variant": "info"})
        items.append(
            {
                "id": p["employeeId"],
                "title": f"{p['rank']}. {p['name']}",
                "subtitle": f"{p['title']}, {p['team']}",
                "badges": badges,
                "secondary_text": _clip(f"{p.get('reason') or ''} Next free {p.get('nextWindow') or 'unknown'}.", 240),
                "primary_cta": {"label": f"Ask {first}", "selection": {"action": "choose", "ask_id": a["askId"], "employee_id": p["employeeId"]}},
            }
        )
    card = Card("carousel", {"title": "Who to ask", "subtitle": _clip((a.get("understanding") or {}).get("restatement"), 120), "items": items})
    return Reply("\n".join(lines), card)


def render_draft(a: dict[str, Any], variant: str | None = None) -> Reply:
    d = a["draft"]
    v = variant or d["suggested"]["variant"]
    m = d["variants"][v]
    r = d["recipient"]
    where = r["slackHandle"] if m["format"] == "slack" else r["email"]
    lines = [
        f"**Draft to {r['name']}** ({m['label']}, {m['formatLabel']} to {where}).",
        f"Why this version: {d['suggested']['why']}" if v == d["suggested"]["variant"] else "",
        "",
        *([f"Subject: {m['subject']}", ""] if m["format"] != "slack" and m.get("subject") else []),
        "```",
        m["body"],
        "```",
        "",
        "Altostratus never sends anything. Copy it, send it yourself, then reply **I sent it**.",
        "Other versions: reply **short**, **full** or **call**." if len(d["variants"]) > 1 else "",
        f"Edit it on the web: {d['web']}",
    ]
    rows = [{"label": "To", "value": f"{r['name']} ({where})"}, {"label": "As", "value": f"{m['label']}, {m['formatLabel']}"}]
    if m["format"] != "slack" and m.get("subject"):
        rows.append({"label": "Subject", "value": _clip(m["subject"], 120)})
    if d.get("slot") and m["format"] == "invite":
        rows.append({"label": "When", "value": d["slot"]})
    rows.append({"label": "Message", "value": _clip(m["body"], 600)})
    card = Card(
        "review",
        {
            "title": f"Send this to {r['name'].split()[0]} yourself",
            "summary_rows": rows,
            "approve_cta": {"label": "I sent it", "selection": {"action": "sent", "ask_id": a["askId"], "variant": v}, "primary": True},
            "reject_cta": {"label": "Not sent yet", "selection": {"action": "not_yet", "ask_id": a["askId"]}},
        },
    )
    return Reply("\n".join(x for x in lines if x is not None), card)


# -------------------------------------------------------------------------------------------------
# the conversation
# -------------------------------------------------------------------------------------------------


class Conversation:
    def __init__(self, client: AltostratusClient, store: Store) -> None:
        self.client = client
        self.store = store

    async def handle(self, sender: str, text: str, progress=None) -> list[Reply]:
        """One incoming chat message -> the replies to send, in order. progress(text) sends an interim line."""
        s = Session.load(self.store, sender)
        intent = parse_intent(text, s)
        log.info("sender %s stage %s ask %s intent %s", short(sender), s.stage, s.ask_id, intent.get("action"))
        try:
            replies = await self._dispatch(sender, s, intent, progress)
        except ApiError as e:
            replies = await self._recover(sender, s, intent, e, progress)
        s.save(self.store, sender)
        return replies

    async def _say(self, progress, line: str) -> None:
        if progress:
            await progress(line)

    async def _dispatch(self, sender: str, s: Session, intent: dict[str, Any], progress) -> list[Reply]:
        action = intent["action"]
        if action == "start_over":
            s.__init__()
            return [Reply("Starting fresh. Describe what you are stuck on, the way you would tell a teammate.")]
        if action == "status":
            if not s.ask_id:
                return [Reply("Describe what you are stuck on and I will find the right colleague, say why, check when they are free and draft the message for you to send.")]
            return [await self._show_current(sender, s)]
        if action == "new_problem":
            return await self._new_problem(sender, s, intent["text"], progress)
        if not s.ask_id and not intent.get("ask_id"):
            return [Reply("There is no ask in progress yet. Describe what you are stuck on first.")]
        ask_id = intent.get("ask_id") or s.ask_id
        s.ask_id = ask_id
        if action in ("find_person", "doc_answered"):
            doc_id = intent.get("doc_id") if action == "doc_answered" else None
            if action == "doc_answered" and not doc_id:
                view = await self.client.view(sender, ask_id)
                doc_id = (view.get("docs") or [{}])[0].get("documentId")
            await self.client.confirm(sender, ask_id, doc_id)
            if doc_id:
                s.stage = "done"
                return [Reply(f"Great, closed {ask_id} as answered by the document, so nobody had to be interrupted. Describe a new problem any time.")]
            await self._say(progress, "Searching ownership, history, skills and docs, then ranking with load and availability...")
            await self.client.run(sender, ask_id)
            return [await self._show_current(sender, s)]
        if action == "choose":
            await self.client.choose(sender, ask_id, intent["employee_id"])
            await self._say(progress, "Drafting the message...")
            await self.client.run(sender, ask_id)
            return [await self._show_current(sender, s)]
        if action == "show_variant":
            view = await self.client.view(sender, ask_id)
            if not view.get("draft"):
                return [await self._show_current(sender, s, view)]
            s.variant = intent["variant"]
            return [render_draft(view, intent["variant"])]
        if action == "not_yet":
            return [Reply("No problem. Nothing has been sent. Reply **I sent it** once you have sent it yourself.")]
        if action == "sent":
            view = await self.client.view(sender, ask_id)
            if view["state"] != "ready" or not view.get("draft"):
                return [await self._show_current(sender, s, view)]
            variant = intent.get("variant") or s.variant or view["draft"]["suggested"]["variant"]
            r = await self.client.sent(sender, ask_id, variant)
            s.stage = "done"
            return [Reply(f"Recorded: you sent it to {r['recipientName']}. Their asks this week: {r['loadAfter']} of {r['max']}{' (now at their limit, so the next similar ask goes to someone else)' if r['loadAfter'] >= r['max'] else ''}. Describe a new problem any time.")]
        return [Reply("I did not catch that. Reply **status** to see where we are, or **start over**.")]

    async def _new_problem(self, sender: str, s: Session, text: str, progress) -> list[Reply]:
        if len(text) < 8:
            return [Reply("Tell me a bit more: what are you trying to do, and what goes wrong?")]
        s.__init__()
        s.last_text = text
        await self._say(progress, "Reading your ask and checking the docs...")
        s.ask_id = await self.client.create_ask(sender, text[:4000])
        await self.client.run(sender, s.ask_id)
        return [await self._show_current(sender, s)]

    async def _show_current(self, sender: str, s: Session, view: dict[str, Any] | None = None) -> Reply:
        a = view or await self.client.view(sender, s.ask_id)
        state = a["state"]
        if state == "confirming":
            s.stage = "confirming"
            return render_understanding(a)
        if state == "shortlist":
            s.stage = "shortlist"
            s.shortlist = [{"id": p["employeeId"], "name": p["name"]} for p in a.get("shortlist") or []]
            return render_shortlist(a)
        if state == "ready" and a.get("draft"):
            s.stage = "ready"
            s.variant = s.variant or a["draft"]["suggested"]["variant"]
            return render_draft(a, s.variant)
        if state in ("sent", "stale"):
            s.stage = "done"
            return Reply(f"{a['askId']} was sent. When they answer, close it on the web: {a['web']}")
        if state == "answered":
            s.stage = "done"
            return Reply(f"{a['askId']} is answered. Describe a new problem any time.")
        if a.get("phase") == "processing":
            return Reply(f"{a['askId']} is still working ({a.get('progress') or state}). Reply **status** in a moment.")
        return Reply(f"{a['askId']} is {a.get('stateLabel', state)}. Open it on the web: {a['web']}")

    async def _recover(self, sender: str, s: Session, intent: dict[str, Any], e: ApiError, progress) -> list[Reply]:
        log.warning("sender %s action %s failed with %s, recovering", short(sender), intent.get("action"), e)
        try:
            if e.code == "ASK_NOT_FOUND" and s.last_text and intent["action"] != "new_problem":
                await self._say(progress, "That ask was cleared (the shared demo was reset). Submitting your problem again...")
                return await self._new_problem(sender, s, s.last_text, progress)
            if e.code in ("ASK_STATE_CONFLICT", "ASK_ILLEGAL_TRANSITION") and s.ask_id:
                return [Reply("That step was already done, here is where the ask stands now."), await self._show_current(sender, s)]
            if e.code == "RANK_EXCLUDED":
                return [Reply(f"{e.message} Pick someone else from the list.")]
        except ApiError as e2:
            log.error("recovery for %s also failed: %s", intent.get("action"), e2)
            e = e2
        if e.code == "RATE_LIMITED":
            return [Reply("Altostratus is getting a lot of asks from this agent right now. Wait a minute and send that again.")]
        if e.code in ("NETWORK", "BAD_RESPONSE"):
            return [Reply("I could not reach Altostratus after three tries. Send that again in a minute; your place in this conversation is kept.")]
        if e.code in ("AGENT_API_DISABLED", "AGENT_API_UNAUTHORIZED"):
            return [Reply("The Altostratus agent connection is switched off or misconfigured on the server. The web app still works.")]
        return [Reply(f"That did not work ({e.code}: {e.message}). Reply **status** to see where we are, or try again. Reference: {e.req_id or 'none'}.")]
