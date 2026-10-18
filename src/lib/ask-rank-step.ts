import "server-only";
// The ranking step: score every retrieved candidate (src/lib/rank.ts, pure, no model), apply the
// fairness guardrails, write the shortlist, then ask the model for one plain reason per person.
// The model only writes the reasons, from that person's evidence and score breakdown; it never
// sees the ask, never chooses anyone, and every reason is fact checked (src/lib/explain-check.ts)
// with a template fallback. The log reconstructs the whole decision:
//
//   grep "ask_1000 rank config"   weights, tune, horizon, asker
//   grep "ask_1000 score "        one line per candidate: raw x weight = contribution, score, guardrails
//   grep "ask_1000 guardrail"     each of the four rules, fired or not, and why
//   grep "ask_1000 shortlist:"    the final order
//   grep "ask_1000 reason "       each reason, where it came from, and any sentence dropped

import { and, eq } from "drizzle-orm";
import { getDb, q, qIn } from "@/db";
import * as t from "@/db/schema";
import type { StepContext, StepResult } from "./ask-pipeline";
import { getSessionUser } from "./auth";
import { horizonLabel } from "./availability";
import { wallNow } from "./clock";
import { getClock } from "./clock-request";
import { AppError } from "./errors";
import { checkReason, cleanModelText } from "./explain-check";
import { createLogger } from "./log";
import { callModel } from "./model";
import { type ExplainPerson, explainFacts } from "./model-purposes";
import { currentMode } from "./mode-request";
import { contextDefaults, getProfile } from "./onboarding";
import { breakdownLine, COMPONENT_LABEL, COMPONENTS, type Features, type GuardrailReport, RANK_CONFIG, rankCandidates, type RankOutcome, type Scored, templateReason, topComponents } from "./rank";
import { buildFeatures, loadCooled, type RankProfile } from "./rank-inputs";
import type { Evidence } from "./retrieval-paths";
import { protectUnderstanding } from "./understand-build";
import { normalizeUnderstanding } from "./understanding";

const log = createLogger("ask.rank");

/** How many people beyond the shortlist get a model reason, so tuning usually has one ready. */
const EXPLAIN_EXTRA = 3;

export type ReasonSource = "model" | "demo" | "template";

export type RankingSummary = {
  version: 1;
  config: string;
  rankedAt: string;
  /** The #1 suggestion at the default tune. The 24 hour cooldown reads this. */
  topId: string | null;
  shortlistIds: string[];
  urgency: string;
  horizon: string;
  askerTz: string;
  availabilityProvider: string;
  /** App time availability and load were computed at; pinned in demo mode (src/lib/clock.ts). Absent before prompt 7. */
  clock?: { now: string; pinned: boolean; reason: string };
  cooled: Record<string, { askId: string; at: string }>;
  guardrails: GuardrailReport[];
  whyNot: RankOutcome["whyNot"];
  explain: { source: "live" | "fixture" | "none" | "skipped"; note: string | null; explained: number; fellBack: string[] };
  counts: { candidates: number; eligible: number; excluded: number };
};

export type RankedBreakdown = {
  stage: "ranked";
  config: string;
  features: Features;
  contributions: Scored["contributions"];
  score: number;
  relevance: number;
  flags: Array<{ rule: string; note: string }>;
  reasonSource: ReasonSource;
  reasonDropped?: Array<{ sentence: string; unsupported: string[] }>;
  sources: string[];
};

function explainPerson(s: Scored, evidence: Evidence[]): ExplainPerson {
  const rank: Record<string, number> = { owner: 0, answered: 1, project: 2, author: 3, skill: 4, profile: 5 };
  return {
    id: s.employeeId,
    firstName: s.name.split(" ")[0],
    evidence: [...evidence].sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9)).map((e) => e.detail),
    components: [...COMPONENTS]
      .sort((a, b) => Math.abs(s.contributions[b]) - Math.abs(s.contributions[a]))
      .map((c) => ({ key: c, label: COMPONENT_LABEL[c], points: s.contributions[c], detail: s.detail[c] })),
    load: s.load,
  };
}

export async function rankAsk({ askId, progress }: StepContext): Promise<StepResult> {
  const [ask] = await q("ask.rank.load", (db) =>
    db
      .select({ understanding: t.asks.understanding, urgency: t.asks.urgency, askerId: t.asks.askerEmployeeId, userId: t.asks.userId, visitorId: t.asks.visitorId })
      .from(t.asks)
      .where(eq(t.asks.id, askId))
      .limit(1),
  );
  if (!ask) throw new AppError("ASK_NOT_FOUND", undefined, { status: 404 });
  const u = normalizeUnderstanding(ask.understanding);
  if (!u) throw new AppError("ASK_STEP_FAILED", "The ask has no understanding to rank with.", { context: { askId } });
  protectUnderstanding(u);
  const urgency = u.urgency ?? ask.urgency;
  const rows = await q("ask.rank.candidates", (db) =>
    db.select({ employeeId: t.askCandidates.employeeId, evidence: t.askCandidates.evidence, sources: t.askCandidates.sources }).from(t.askCandidates).where(eq(t.askCandidates.askId, askId)),
  );
  const evidenceOf = new Map(rows.map((r) => [r.employeeId, (r.evidence as Evidence[]) ?? []]));
  const sourcesOf = new Map(rows.map((r) => [r.employeeId, r.sources]));

  await progress(`scoring ${rows.length} ${rows.length === 1 ? "person" : "people"} on ownership, skills, recency, availability, mentoring, load, team and time zone`);

  // The asker's preferences from onboarding; signed-out visitors and skipped steps get defaults.
  let profile: RankProfile;
  const p = ask.userId ? await getProfile(ask.userId) : null;
  if (p) {
    profile = { okToInterruptSeniors: p.okToInterruptSeniors, knownSkillIds: p.knownSkillIds, preferredChannel: p.preferredChannel, source: `onboarding profile of ${ask.userId}` };
  } else {
    const d = await contextDefaults(ask.askerId);
    profile = { okToInterruptSeniors: false, knownSkillIds: d.knownSkillIds, preferredChannel: "slack", source: ask.userId ? `defaults, ${ask.userId} has no profile` : "defaults for a signed-out visitor" };
  }
  log.branch(`${askId} rank profile`, `${profile.source}: peers first ${!profile.okToInterruptSeniors}, ${profile.knownSkillIds.length} known skills, prefers ${profile.preferredChannel}`, { askId });

  await progress(`checking free and busy time for ${horizonLabel(urgency)}`);
  // App time (pinned in demo mode) for calendars and load; wall time for the cooldown, which is
  // about how often this asker really asked.
  const clock = await getClock();
  const now = clock.now;
  const rankedAt = wallNow();
  const asker = { employeeId: ask.askerId, userId: ask.userId, visitorId: ask.visitorId };
  const [{ features, askerTz, horizon, provider }, cooled] = await Promise.all([
    buildFeatures({ label: askId, candidates: rows.map((r) => ({ employeeId: r.employeeId, evidence: evidenceOf.get(r.employeeId) ?? [] })), u, asker, profile, urgency, now }),
    loadCooled(askId, asker, rankedAt),
  ]);

  const outcome = rankCandidates(features, { tune: 0, cooled });
  const W = outcome.weights;
  log.info(`${askId} rank config ${RANK_CONFIG.version} tune=0 weights ${COMPONENTS.map((c) => `${c}=${W[c]}`).join(" ")} urgency=${urgency} horizon="${horizon}" availability=${provider} askerTz=${askerTz} clock=${clock.pinned ? "pinned" : "system"} now=${now.toISOString()}`, { askId, guardrails: RANK_CONFIG.guardrails, shortlist: RANK_CONFIG.shortlist });

  // One line per candidate: every component raw x weight = contribution, the score, guardrails.
  const placed = new Map<string, number>(outcome.shortlist.map((s) => [s.employeeId, s.rank]));
  const flagsOf = new Map(outcome.shortlist.map((s) => [s.employeeId, s.flags]));
  for (const s of [...outcome.shortlist, ...outcome.rest, ...outcome.excluded]) {
    const g = [...(s.excluded ? [`${s.excluded.rule} (${s.excluded.reason})`] : []), ...(flagsOf.get(s.employeeId) ?? []).map((f) => `${f.rule} (${f.note})`)];
    log.info(
      `${askId} score ${s.employeeId} ${s.name} = ${s.score} [${breakdownLine(s, W)}] relevance ${s.relevance} load ${s.load.count}/${s.load.max} availability ${s.availability.status}${s.availability.nextFreeLabel ? ` ${s.availability.nextFreeLabel}` : ""}; ${placed.has(s.employeeId) ? `shortlist #${placed.get(s.employeeId)}` : s.excluded ? "EXCLUDED" : "not shortlisted"}; guardrails: ${g.length ? g.join("; ") : "none"}`,
      { askId, employeeId: s.employeeId, raw: s.raw, contributions: s.contributions },
    );
  }
  for (const r of outcome.guardrails) {
    if (r.fired) log.info(`${askId} guardrail ${r.rule} FIRED: ${r.summary}`, { askId, people: r.people });
    else log.branch(`${askId} guardrail ${r.rule} not fired`, r.summary, { askId });
  }
  log.info(`${askId} shortlist: ${outcome.shortlist.map((s) => `#${s.rank} ${s.employeeId} ${s.name} ${s.score}`).join(", ") || "empty"}; ${outcome.rest.length} more eligible, ${outcome.excluded.length} excluded`, { askId });
  if (outcome.whyNot) log.info(`${askId} why not ${outcome.whyNot.employeeId}: ${outcome.whyNot.text}`, { askId });
  else log.branch(`${askId} no why-not line`, "nobody was excluded or moved and the most relevant person is #1");

  for (const r of outcome.guardrails.filter((x) => x.fired)) {
    if (r.rule === "hard_cap" || r.rule === "out_of_office") {
      const first = outcome.excluded.find((s) => s.excluded?.rule === r.rule)!;
      await progress(`routed around ${first.name}: ${first.excluded!.reason}${r.people.length > 1 ? ` (and ${r.people.length - 1} more)` : ""}`);
    } else await progress(`${r.rule === "cooldown" ? "cooldown" : "spread"}: ${r.summary}`);
  }

  const topRec = outcome.shortlist[0]?.availability.recommendation;
  if (topRec) await progress(`${topRec.headline}: ${topRec.rule === "blocked_now_free_within_hour" ? "free within the hour" : topRec.channel === "async" ? "does not take their time" : "free sooner"}`);
  else log.skip(`${askId} channel progress line`, "nobody on the shortlist");

  // Reasons: one model call for the shortlist plus a few runners up.
  const toExplain = [...outcome.shortlist, ...outcome.rest.slice(0, EXPLAIN_EXTRA)];
  const reasons = new Map<string, { text: string; source: ReasonSource; dropped?: RankedBreakdown["reasonDropped"] }>();
  const fellBack: string[] = [];
  let explain: RankingSummary["explain"] = { source: "skipped", note: null, explained: 0, fellBack };
  if (toExplain.length) {
    await progress(`writing a one-line reason for ${toExplain.length === 1 ? "the one person" : `each of ${toExplain.length} people`} from their evidence`);
    const people = toExplain.map((s) => explainPerson(s, evidenceOf.get(s.employeeId) ?? []));
    const [user, mode] = await Promise.all([getSessionUser(), currentMode()]);
    const r = await callModel({ purpose: "explain_ranking", input: { askId, people }, user, mode, askId });
    const got = new Map((r.output ?? []).map((x) => [x.id, x.reason]));
    const via: ReasonSource = r.source === "live" ? "model" : "demo";
    for (const s of toExplain) {
      const person = people.find((x) => x.id === s.employeeId)!;
      const text = got.get(s.employeeId);
      const tmpl = templateReason(s);
      if (!text) {
        fellBack.push(s.employeeId);
        reasons.set(s.employeeId, { text: tmpl, source: "template" });
        log.branch(`${askId} reason ${s.employeeId} via=template`, `${r.source === "none" ? r.code : "the model returned no reason for this person"}; template from ${topComponents(s).join(" and ")}: "${tmpl}"`, { askId });
        continue;
      }
      const cleaned = cleanModelText(text);
      if (cleaned !== text.trim()) log.warn(`${askId} reason ${s.employeeId}: removed dashes from the model text`, { askId });
      const check = checkReason(cleaned, explainFacts(person));
      for (const d of check.dropped) log.warn(`${askId} reason ${s.employeeId}: DROPPED sentence with facts not in the evidence ${JSON.stringify(d.unsupported)}: "${d.sentence}"`, { askId });
      if (check.ok) {
        reasons.set(s.employeeId, { text: check.kept, source: via, dropped: check.dropped.length ? check.dropped : undefined });
        log.info(`${askId} reason ${s.employeeId} via=${via}: "${check.kept}"`, { askId });
      } else {
        fellBack.push(s.employeeId);
        reasons.set(s.employeeId, { text: tmpl, source: "template", dropped: check.dropped });
        log.branch(`${askId} reason ${s.employeeId} via=template`, `every sentence from ${via} introduced a fact not in the evidence; template from ${topComponents(s).join(" and ")}: "${tmpl}"`, { askId });
      }
    }
    explain = { source: r.source, note: r.source === "live" ? null : r.note, explained: toExplain.length, fellBack };
  } else {
    log.skip(`${askId} explain_ranking`, "nobody is eligible, so there is nothing to explain");
  }

  const summary: RankingSummary = {
    version: 1,
    config: RANK_CONFIG.version,
    rankedAt: rankedAt.toISOString(),
    topId: outcome.shortlist[0]?.employeeId ?? null,
    shortlistIds: outcome.shortlist.map((s) => s.employeeId),
    urgency,
    horizon,
    askerTz,
    availabilityProvider: provider,
    clock: { now: now.toISOString(), pinned: clock.pinned, reason: clock.reason },
    cooled,
    guardrails: outcome.guardrails,
    whyNot: outcome.whyNot,
    explain,
    counts: { candidates: features.length, eligible: outcome.shortlist.length + outcome.rest.length, excluded: outcome.excluded.length },
  };

  const all: Scored[] = [...outcome.shortlist, ...outcome.rest, ...outcome.excluded];
  await getDb().transaction(async (tx) => {
    for (const s of all) {
      const reason = reasons.get(s.employeeId);
      const { contributions, score, relevance, ...rest } = s;
      const features: Features = { employeeId: rest.employeeId, name: rest.name, title: rest.title, team: rest.team, seniority: rest.seniority, raw: rest.raw, detail: rest.detail, load: rest.load, availability: rest.availability, ownerOf: rest.ownerOf, excluded: rest.excluded };
      const breakdown: RankedBreakdown = {
        stage: "ranked",
        config: RANK_CONFIG.version,
        features,
        contributions,
        score,
        relevance,
        flags: flagsOf.get(s.employeeId) ?? [],
        reasonSource: reason?.source ?? "template",
        ...(reason?.dropped ? { reasonDropped: reason.dropped } : {}),
        sources: sourcesOf.get(s.employeeId) ?? [],
      };
      await qIn(tx, "ask.rank.candidate", (h) =>
        h
          .update(t.askCandidates)
          .set({ rank: placed.get(s.employeeId) ?? null, score, breakdown, explanation: reason?.text ?? null })
          .where(and(eq(t.askCandidates.askId, askId), eq(t.askCandidates.employeeId, s.employeeId))),
      );
    }
    await qIn(tx, "ask.rank.summary", (h) => h.update(t.asks).set({ ranking: summary }).where(eq(t.asks.id, askId)));
  });

  await progress(outcome.shortlist.length ? `${outcome.shortlist.length} ${outcome.shortlist.length === 1 ? "person" : "people"} on the shortlist` : "nobody could take this ask right now");
  const fired = outcome.guardrails.filter((r) => r.fired);
  return {
    to: "shortlist",
    reason: `ranked ${features.length}: ${outcome.shortlist.map((s) => `#${s.rank} ${s.employeeId} (${s.score})`).join(", ") || "nobody eligible"}; guardrails fired: ${fired.map((r) => `${r.rule}(${r.people.join(",")})`).join(" ") || "none"}`,
    data: {
      shortlist: summary.shortlistIds,
      excluded: outcome.excluded.map((s) => `${s.employeeId}:${s.excluded!.rule}`),
      guardrails: Object.fromEntries(outcome.guardrails.map((r) => [r.rule, r.fired])),
      reasons: explain.source,
    },
  };
}
