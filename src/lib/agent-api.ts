import "server-only";
// The JSON API the ASI:One agent calls (FEATURE_FETCH_AGENT; the agent is agents/fetch/). It does
// not reimplement anything: each route calls the same function the web UI's server action calls
// (createAndSubmitAsk, confirmAsk, chooseCandidate, markSent), and the agent drives the pipeline
// through the existing POST /api/asks/[askId]/run and polls GET /api/asks/[askId].
//
// Identity: every request carries the bearer AGENT_API_TOKEN and the ASI:One sender address
// (X-Agent-Sender). The agent acts as a signed-out visitor whose w2a_visitor cookie is derived from
// the token and the sender (visitorIdFor), so each ASI:One user owns their own asks, in demo mode,
// exactly as a signed-out web visitor would; agentGuard refuses a cookie that does not match.
// Logged as [agent.api] with the sender's short form; ask text is never logged here.

import { createHash, timingSafeEqual } from "node:crypto";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { q } from "@/db";
import * as t from "@/db/schema";
import { ASK_STATE_DEFS } from "./ask-state";
import { asRanking, getDocChecks, getDraftView, getRanking } from "./ask-review";
import { getAskDetail } from "./asks";
import { DRAFT_VARIANTS, FORMAT_LABEL, VARIANT_DEF } from "./draft";
import { AppError } from "./errors";
import { flagOn } from "./flags";
import { createLogger } from "./log";
import { enforceRateLimit } from "./rate-limit";
import { normalizeUnderstanding } from "./understanding";
import { VISITOR_COOKIE } from "./viewer";

const log = createLogger("agent.api");

/** The visitor id an ASI:One sender acts as. The agent computes the same value (agents/fetch/altostratus_client.py). */
export function visitorIdFor(token: string, sender: string): string {
  return `vis_${createHash("sha256").update(`${token}:${sender}`).digest("hex").slice(0, 16)}`;
}

function short(sender: string): string {
  return sender.length > 16 ? `${sender.slice(0, 10)}...${sender.slice(-4)}` : sender;
}

/** Flag, token, sender, cookie, rate limit. Returns the sender for log lines. */
export async function agentGuard(req: NextRequest, what: string): Promise<{ sender: string }> {
  if (!flagOn("fetch_agent", `agent api ${what}`)) {
    log.info(`agent api ${what} refused: FEATURE_FETCH_AGENT is off`);
    throw new AppError("AGENT_API_DISABLED", undefined, { status: 404 });
  }
  const token = process.env.AGENT_API_TOKEN ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(token).digest();
  if (!token || !given || !timingSafeEqual(a, b)) {
    log.warn(`auth decision: deny agent api ${what} (${!token ? "AGENT_API_TOKEN not set on the server" : !given ? "no bearer token" : "wrong bearer token"})`);
    throw new AppError("AGENT_API_UNAUTHORIZED", undefined, { status: 401 });
  }
  const sender = req.headers.get("x-agent-sender") ?? "";
  if (!/^[A-Za-z0-9_.:-]{3,140}$/.test(sender)) {
    log.warn(`agent api ${what} refused: X-Agent-Sender missing or malformed (${sender.length} chars)`);
    throw new AppError("BAD_REQUEST", "X-Agent-Sender must be the ASI:One sender address.", { status: 400 });
  }
  const cookie = req.cookies.get(VISITOR_COOKIE)?.value;
  const expected = visitorIdFor(token, sender);
  if (cookie !== expected) {
    log.warn(`auth decision: deny agent api ${what} for ${short(sender)} (visitor cookie ${cookie ? "does not match the sender" : "missing"})`);
    throw new AppError("AGENT_API_UNAUTHORIZED", "The visitor cookie does not belong to this sender.", { status: 401 });
  }
  await enforceRateLimit("agent_sender", sender);
  log.info(`auth decision: allow agent api ${what} for sender ${short(sender)} as ${expected}`);
  return { sender };
}

/** The whole ask in one JSON object, shaped for a chat: what was understood, who, why, the draft. */
export async function agentAskView(askId: string, origin: string) {
  const d = await getAskDetail(askId);
  const { ask } = d;
  const u = normalizeUnderstanding(ask.understanding);
  const [docs, ranking, draft, ranks] = await Promise.all([
    getDocChecks(askId),
    getRanking(askId, ask.ranking),
    getDraftView(askId, ask.draft),
    q("agent.view.ranks", (db) =>
      db
        .select({ employeeId: t.askCandidates.employeeId, rank: t.askCandidates.rank, score: t.askCandidates.score })
        .from(t.askCandidates)
        .where(and(eq(t.askCandidates.askId, askId), isNotNull(t.askCandidates.rank)))
        .orderBy(asc(t.askCandidates.rank)),
    ),
  ]);
  const summary = asRanking(ask.ranking);
  const people = new Map((ranking?.people ?? []).map((p) => [p.features.employeeId, p]));
  const shortlist = ranks.flatMap((r) => {
    const p = people.get(r.employeeId);
    if (!p) return [];
    const f = p.features;
    return [
      {
        rank: r.rank,
        employeeId: f.employeeId,
        name: f.name,
        title: f.title,
        team: f.team,
        reason: p.reason,
        score: r.score === null ? null : Math.round(r.score * 10) / 10,
        load: `${f.load.count} of ${f.load.max} asks this week`,
        nextWindow: f.availability.window?.label ?? f.availability.nextFreeLabel ?? null,
        suggestion: f.availability.recommendation ? `${f.availability.recommendation.headline}. ${f.availability.recommendation.reason}` : null,
        owns: f.ownerOf.map((o) => `${o.serviceName} (${o.role})`),
        chosen: p.chosen,
        profile: `${origin}/directory/${f.employeeId}`,
      },
    ];
  });
  const view = {
    askId,
    state: ask.status,
    phase: ASK_STATE_DEFS[ask.status].phase,
    stateLabel: ASK_STATE_DEFS[ask.status].label,
    progress: ask.progress,
    lastErrorCode: ask.lastErrorCode,
    web: `${origin}/ask/${askId}`,
    understanding: u
      ? {
          restatement: u.restatement,
          services: u.services.map((s) => s.name),
          skills: u.skills.map((s) => s.name),
          helpKind: u.helpKind,
          urgency: u.urgency,
          mentioned: u.artifacts.map((a) => `${a.kind}: ${a.text}`),
          keptOut: u.sensitive.length,
          glossary: u.glossary ? { via: u.glossary.via, hits: u.glossary.hits.map((h) => ({ phrase: h.phrase, means: h.means })), unknown: u.glossary.unknown } : null,
          note: u.note,
          parsed: u.parse?.line ?? null,
        }
      : null,
    docs: docs.map((x) => ({ documentId: x.documentId, title: x.title, why: x.why, quote: x.section.length > 700 ? `${x.section.slice(0, 697)}...` : x.section, verdict: x.verdict, link: `${origin}/docs/${x.documentId}` })),
    shortlist,
    whyNot: summary?.whyNot?.text ?? null,
    guardrailsFired: (summary?.guardrails ?? []).filter((g) => g.fired).map((g) => ({ rule: g.rule, summary: g.summary })),
    rankNote: summary?.explain.note ?? null,
    draft: draft
      ? {
          recipient: { name: draft.summary.recipient.name, title: draft.summary.recipient.title, slackHandle: draft.summary.recipient.slackHandle, email: draft.summary.recipient.email },
          suggested: { variant: draft.summary.suggested.variant, format: draft.summary.suggested.format, why: draft.summary.suggested.why },
          variants: Object.fromEntries(
            DRAFT_VARIANTS.map((v) => [v, { label: VARIANT_DEF[v].label, format: draft.messages[v].format, formatLabel: FORMAT_LABEL[draft.messages[v].format], subject: draft.messages[v].subject, body: draft.messages[v].body }]),
          ),
          slot: draft.summary.input.slot?.label ?? null,
          sent: draft.summary.sent ? { variant: draft.summary.sent.variant, loadAfter: draft.summary.sent.loadAfter, max: draft.summary.sent.max } : null,
          note: draft.summary.note ?? null,
          web: `${origin}/ask/${askId}/draft/${draft.summary.suggested.variant}`,
        }
      : null,
  };
  log.info(`${askId} agent view: state ${ask.status}, ${docs.length} doc(s), ${shortlist.length} on the shortlist, draft ${draft ? "yes" : "no"}`, { askId });
  return view;
}
