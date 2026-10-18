import "server-only";
// The drafting step: write the message the asker will send to the person they chose. One
// draft_ask call through callModel gives three variants (short, full context, call request); the
// demo fixture builds the same three from the same input. Nothing is ever sent from here.
//
// The input is built only from what the asker confirmed and what ranking found: the restated
// question, what they tried, the recipient and how they relate to the asker, the evidence for
// why this person, the recommended channel and a 15 minute slot from the availability engine.
// Sensitive spans and the confidential note are removed before the input exists, so neither the
// model nor the log ever sees them. Every variant then passes the grounding check
// (src/lib/draft.ts groundDraft): a sentence that names a service, repo, project or person that is
// not in the input is stripped and logged. The log reconstructs it:
//
//   grep "ask_1000 draft input payload"   the full input, as the model saw it
//   grep "ask_1000 grounding"             per variant: ok, or each STRIPPED sentence and the names in it
//   grep "ask_1000 draft suggested"       which variant and format the page opens with, and why

import { and, eq, isNull } from "drizzle-orm";
import { getDb, q, qIn } from "@/db";
import * as t from "@/db/schema";
import type { StepContext, StepResult } from "./ask-pipeline";
import type { RankedBreakdown } from "./ask-rank-step";
import { URGENCY_LABEL } from "./ask-state";
import { nextWindow, slotLabel } from "./availability";
import type { Recommendation } from "./availability-types";
import { wallNow } from "./clock";
import { getClock } from "./clock-request";
import { getSessionUser } from "./auth";
import { CALL_MINUTES, cleanDraftText, type DraftFormat, type DraftInput, type DraftOutput, type DraftVariant, DRAFT_VARIANTS, groundDraft, inputCorpus, knownNames, type Relationship, type StrippedSentence, VARIANT_DEF, wordCount } from "./draft";
import { AppError } from "./errors";
import { createLogger, markSensitive } from "./log";
import { callModel } from "./model";
import { demoDraft } from "./model-purposes";
import { currentMode } from "./mode-request";
import { contextDefaults, getProfile } from "./onboarding";
import { SENIORITY_LEVEL } from "./rank-inputs";
import type { Evidence } from "./retrieval-paths";
import { localTime, ZONE_LABEL } from "./time";
import { protectUnderstanding } from "./understand-build";
import { HELP_KIND_LABEL, normalizeUnderstanding } from "./understanding";

const log = createLogger("ask.draft");

const DAY_MS = 86_400_000;

export type DraftVia = "model" | "demo" | "template";

/** Stored in asks.draft. Safe to show and log: built after the scrub. */
export type DraftSummary = {
  version: 1;
  draftedAt: string;
  recipient: { id: string; name: string; firstName: string; slackHandle: string; email: string; title: string; team: string };
  input: DraftInput;
  suggested: { variant: DraftVariant; format: DraftFormat; why: string };
  /** The recommendation came from ranking; set when it pointed at someone else (the other owner). */
  recommendationTarget: { id: string; name: string } | null;
  via: DraftVia;
  source: "live" | "fixture" | "none";
  note: string | null;
  grounding: Record<DraftVariant, { ok: boolean; stripped: StrippedSentence[]; fellBack: boolean; words: number }>;
  scrub: { protectedSpans: number; triedSentencesRemoved: number; mentionedRemoved: number; restatementSentencesRemoved: number };
  clock: { now: string; pinned: boolean };
  /** Set by "I sent this" (src/lib/ask-outcome.ts): what went out and the recipient's load around it. */
  sent?: { variant: DraftVariant; format: DraftFormat; words: number; edited: boolean; at: string; appAt: string; loadBefore: number; loadAfter: number; max: number };
};

export function asDraftSummary(raw: unknown): DraftSummary | null {
  return raw && typeof raw === "object" && (raw as DraftSummary).version === 1 && !!(raw as DraftSummary).input ? (raw as DraftSummary) : null;
}

const zone = (tz: string) => ZONE_LABEL[tz] ?? tz;
const first = (name: string) => name.split(" ")[0] ?? name;

/** Drop every sentence that contains a protected string. Returns the rest and how many went. */
function scrubSentences(text: string, guard: string[]): { text: string; removed: number } {
  const g = guard.map((x) => x.toLowerCase());
  const parts = text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());
  const kept = parts.filter((s) => !g.some((x) => s.toLowerCase().includes(x)));
  return { text: kept.join(" ").trim(), removed: parts.length - kept.length };
}

type Person = { id: string; name: string; title: string; team: string; department: string; seniority: string; timezone: string; managerId: string | null; slackHandle: string; email: string; startDate: string };

function relationshipOf(asker: Person, rec: Person, chain: string[], mentors: boolean): Relationship {
  const levelsAbove = (SENIORITY_LEVEL[rec.seniority] ?? 0) - (SENIORITY_LEVEL[asker.seniority] ?? 0);
  const seniority = levelsAbove >= 2 ? "much_more_senior" : levelsAbove === 1 ? "more_senior" : levelsAbove === 0 ? "peer" : "more_junior";
  const kind =
    asker.managerId === rec.id
      ? "manager"
      : rec.managerId === asker.id
        ? "report"
        : mentors
          ? "mentor"
          : chain.includes(rec.id)
            ? "manager_chain"
            : rec.team === asker.team
              ? "same_team"
              : rec.department === asker.department
                ? "same_department"
                : "other_team";
  const where =
    kind === "manager"
      ? "and your manager"
      : kind === "report"
        ? "on your team, reporting to you"
        : rec.team === asker.team
          ? `on ${rec.team}, your own team`
          : rec.department === asker.department
            ? `on ${rec.team}, another team in ${rec.department}`
            : `on ${rec.team}, in ${rec.department} (you are in ${asker.department})`;
  const level = levelsAbove > 0 ? `${levelsAbove} ${levelsAbove === 1 ? "level" : "levels"} more senior than you` : levelsAbove === 0 ? "at your level" : "less senior than you";
  const sentence = `${rec.name} is ${/^[AEIOU]/.test(rec.title) ? "an" : "a"} ${rec.title} ${where}, ${level}${mentors && kind !== "mentor" ? ", and mentors you" : kind === "mentor" ? ", and is your mentor" : ""}.`;
  return { kind, seniority, levelsAbove, sentence };
}

function suggestVariant(rel: Relationship, rec: Recommendation | null, firstName: string): { variant: DraftVariant; why: string } {
  if (rec?.channel === "call") return { variant: "call", why: `The suggested channel is a short call, so the call request asks ${firstName} for one slot with the question up front.` };
  if (rel.seniority === "much_more_senior") return { variant: "full", why: `${firstName} is ${rel.levelsAbove} levels more senior than you, so the full context version lets them decide fast whether to engage.` };
  return { variant: "short", why: `${firstName} is ${rel.seniority === "peer" ? "at your level" : rel.seniority === "more_senior" ? "one level more senior" : "less senior than you"}, so the short version is enough.` };
}

function suggestFormat(rec: Recommendation | null, preferred: string): { format: DraftFormat; why: string } {
  if (rec?.channel === "call") return { format: "invite", why: "the suggestion is a call, so it is laid out as a calendar invite" };
  if (rec?.channel === "dm") return { format: "slack", why: "the suggestion is a direct message, so it is laid out as a Slack DM" };
  if (preferred === "email") return { format: "email", why: "an async message, and you prefer email" };
  return { format: "slack", why: `an async message, and you prefer ${preferred === "call" ? "calls, which an async ask does not need, so Slack" : "Slack"}` };
}

export async function draftAsk({ askId, progress }: StepContext): Promise<StepResult> {
  const [ask] = await q("ask.draft.load", (db) =>
    db
      .select({ understanding: t.asks.understanding, tried: t.asks.tried, confidential: t.asks.confidential, urgency: t.asks.urgency, askerId: t.asks.askerEmployeeId, userId: t.asks.userId })
      .from(t.asks)
      .where(eq(t.asks.id, askId))
      .limit(1),
  );
  if (!ask) throw new AppError("ASK_NOT_FOUND", undefined, { status: 404 });
  // Read only to leave it out: from here on the note is scrubbed from every line of this request.
  markSensitive(ask.confidential);
  const u = normalizeUnderstanding(ask.understanding);
  if (!u) throw new AppError("ASK_STEP_FAILED", "The ask has no understanding to draft from.", { context: { askId } });
  protectUnderstanding(u);
  const guard = [...u.sensitive.map((s) => s.text), ...(ask.confidential ? [ask.confidential] : [])].map((s) => s.trim()).filter((s) => s.length >= 3);
  const urgency = u.urgency ?? ask.urgency;

  const [chosen] = await q("ask.draft.chosen", (db) =>
    db
      .select({ employeeId: t.askCandidates.employeeId, breakdown: t.askCandidates.breakdown, evidence: t.askCandidates.evidence, explanation: t.askCandidates.explanation })
      .from(t.askCandidates)
      .where(and(eq(t.askCandidates.askId, askId), eq(t.askCandidates.chosen, true)))
      .limit(1),
  );
  if (!chosen) throw new AppError("ASK_STEP_FAILED", "Nobody was chosen from the shortlist.", { context: { askId } });
  if (!ask.askerId) throw new AppError("ASK_STEP_FAILED", "The ask has no persona to write as.", { context: { askId } });
  const b = chosen.breakdown as Partial<RankedBreakdown>;

  const cols = {
    id: t.employees.id,
    name: t.employees.name,
    title: t.employees.title,
    team: t.employees.team,
    department: t.employees.department,
    seniority: t.employees.seniority,
    timezone: t.employees.timezone,
    managerId: t.employees.managerId,
    slackHandle: t.employees.slackHandle,
    email: t.employees.email,
    startDate: t.employees.startDate,
  };
  const [people, mentorRows, catalogServices, catalogProjects, catalogPeople] = await Promise.all([
    q("ask.draft.people", (db) => db.select(cols).from(t.employees)),
    q("ask.draft.mentorship", (db) =>
      db
        .select({ id: t.mentorships.id })
        .from(t.mentorships)
        .where(and(eq(t.mentorships.mentorId, chosen.employeeId), eq(t.mentorships.menteeId, ask.askerId!), isNull(t.mentorships.endedOn)))
        .limit(1),
    ),
    q("ask.draft.names.services", (db) => db.select({ name: t.services.name, repo: t.services.repo }).from(t.services)),
    q("ask.draft.names.projects", (db) => db.select({ name: t.projects.name }).from(t.projects)),
    q("ask.draft.names.people", (db) => db.select({ name: t.employees.name }).from(t.employees)),
  ]);
  const byId = new Map(people.map((p) => [p.id, p as Person]));
  const asker = byId.get(ask.askerId);
  const rec = byId.get(chosen.employeeId);
  if (!asker || !rec) throw new AppError("ASK_STEP_FAILED", "The asker or the chosen person is no longer in the company (reseeded?).", { context: { askId } });
  const chain: string[] = [];
  for (let cur = asker.managerId, i = 0; cur && i < 8; i++) {
    chain.push(cur);
    cur = byId.get(cur)?.managerId ?? null;
  }

  await progress(`writing three versions of a message to ${rec.name}: short, full context and call request`);

  // The asker's own context: onboarding answers, or the persona defaults.
  const profile = ask.userId ? await getProfile(ask.userId) : null;
  const defaults = profile?.firstFocus ? null : await contextDefaults(asker.id);
  const preferred = profile?.preferredChannel ?? "slack";
  const focusRaw = profile?.firstFocus || defaults?.firstFocus || "";
  log.branch(`${askId} draft asker context`, profile ? `onboarding profile of ${ask.userId} (prefers ${preferred}${profile.firstFocus ? ", focus from onboarding" : ", focus from persona defaults"})` : `defaults for ${ask.userId ? "an account without a profile" : "a signed-out visitor"}: Slack, focus from the persona's active project`, { askId });

  // The 15 minute slot for the call request, at the same app time the rest of this run uses.
  const clock = await getClock();
  const now = clock.now;
  const slotRes = await nextWindow(rec.id, CALL_MINUTES, urgency, now);
  const slot = slotRes?.slot
    ? {
        start: slotRes.slot.start.toISOString(),
        end: slotRes.slot.end.toISOString(),
        label: `${slotLabel(slotRes.slot.start, rec.timezone)}${rec.timezone !== asker.timezone ? ` (${localTime(slotRes.slot.start, asker.timezone)} ${zone(asker.timezone)} for me)` : ""}`,
        soft: slotRes.slot.soft,
      }
    : null;
  if (slot) {
    log.info(`${askId} draft slot for ${rec.id}: ${CALL_MINUTES} min at ${slot.label}${slot.soft ? " (in focus time, allowed because the ask is blocked now)" : ""} (${slotRes!.reason})`, { askId, start: slot.start });
    await progress(`found ${CALL_MINUTES} free minutes on ${first(rec.name)}'s calendar: ${slot.label}`);
  } else {
    log.skip(`${askId} draft slot for ${rec.id}`, slotRes ? `no ${CALL_MINUTES} minute window in the next 14 days (${slotRes.reason}); the call request asks for any time` : "no such employee");
  }

  // The scrub: nothing marked sensitive and nothing from the confidential note enters the input.
  const restatement = scrubSentences(u.restatement, guard);
  const tried = ask.tried ? scrubSentences(ask.tried, guard) : { text: "", removed: 0 };
  const mentioned = u.artifacts.map((a) => a.text).filter((x) => !guard.some((g) => x.toLowerCase().includes(g.toLowerCase())));
  const scrub = { protectedSpans: guard.length, triedSentencesRemoved: tried.removed, mentionedRemoved: u.artifacts.length - mentioned.length, restatementSentencesRemoved: restatement.removed };
  if (guard.length) log.info(`${askId} draft scrub: ${guard.length} protected span(s) (${u.sensitive.length} sensitive${ask.confidential ? ", plus the confidential note" : ""}) kept out of the input; removed ${tried.removed} sentence(s) of what was tried, ${scrub.mentionedRemoved} mentioned item(s), ${restatement.removed} restatement sentence(s)`, { askId });
  else log.branch(`${askId} draft scrub: nothing to remove`, "no sensitive spans and no confidential note on this ask", { askId });

  const recommendation = b.features?.availability?.recommendation ?? null;
  const relationship = relationshipOf(asker, rec, chain, mentorRows.length > 0);
  const format = suggestFormat(recommendation, preferred);
  const evidence = ((chosen.evidence as Evidence[]) ?? [])
    .slice()
    .sort((x, y) => (EVIDENCE_ORDER[x.kind] ?? 9) - (EVIDENCE_ORDER[y.kind] ?? 9))
    .slice(0, 3)
    .map((e) => e.detail);
  const recTarget = recommendation && recommendation.targetId !== rec.id ? { id: recommendation.targetId, name: recommendation.targetName } : null;
  if (recTarget) log.branch(`${askId} draft for ${rec.id}, not the suggested ${recTarget.id}`, `ranking suggested ${recommendation!.headline}, but the asker chose ${rec.name}; the draft follows the choice`, { askId });

  const startMs = Date.parse(`${asker.startDate}T00:00:00Z`);
  const input: DraftInput = {
    askId,
    asker: {
      firstName: first(asker.name),
      title: asker.title,
      team: asker.team,
      daysIn: Number.isFinite(startMs) ? Math.max(0, Math.floor((now.getTime() - startMs) / DAY_MS)) : null,
      zone: zone(asker.timezone),
      focus: scrubSentences(focusRaw, guard).text || null,
    },
    recipient: { id: rec.id, firstName: first(rec.name), name: rec.name, title: rec.title, team: rec.team, slackHandle: rec.slackHandle, email: rec.email, zone: zone(rec.timezone) },
    relationship,
    question: {
      restatement: restatement.text || `I have a question about ${u.services[0]?.name ?? u.skills[0]?.name ?? "something I am working on"}.`,
      helpKind: HELP_KIND_LABEL[u.helpKind],
      services: u.services.map((s) => s.name),
      skills: u.skills.map((s) => s.name),
      mentioned,
    },
    tried: tried.text || null,
    urgency: { key: urgency, label: URGENCY_LABEL[urgency] },
    why: { evidence, reason: chosen.explanation },
    channel: { recommended: recommendation?.channel ?? "async", rule: recommendation?.rule ?? "none", headline: recommendation?.headline ?? `Send ${first(rec.name)} an async message`, format: format.format },
    slot,
  };
  log.info(`${askId} draft input payload ${JSON.stringify(input)}`, { askId });

  const v = suggestVariant(relationship, recommendation, first(rec.name));
  const suggested = { variant: v.variant, format: format.format, why: `${v.why} It is laid out as ${format.format === "invite" ? "a calendar invite" : format.format === "email" ? "an email" : "a Slack DM"}: ${format.why}.` };
  log.info(`${askId} draft suggested variant=${v.variant} format=${format.format}: ${suggested.why}`, { askId, relationship: relationship.kind, seniority: relationship.seniority });

  const [user, mode] = await Promise.all([getSessionUser(), currentMode()]);
  const r = await callModel({ purpose: "draft_ask", input, user, mode, askId });
  const via: DraftVia = r.source === "live" ? "model" : r.source === "fixture" ? "demo" : "template";
  if (r.source === "none") log.branch(`${askId} draft via=template`, `${r.code}: no live result and no demo result, building the drafts from the committed lines`, { askId });
  const raw: DraftOutput = r.output ?? demoDraft(input);
  const fallback = demoDraft(input);

  await progress("checking every name in the drafts against what you told us and what the search found");
  const corpus = inputCorpus(input);
  const names = knownNames({ services: catalogServices, projects: catalogProjects.map((p) => p.name), people: catalogPeople.map((p) => p.name) });
  const finals = {} as DraftOutput;
  const grounding = {} as DraftSummary["grounding"];
  for (const variant of DRAFT_VARIANTS) {
    const text = { subject: cleanDraftText(raw[variant].subject), body: cleanDraftText(raw[variant].body) };
    if (text.body !== raw[variant].body.trim()) log.debug(`${askId} grounding ${variant}: normalised dashes and spacing in the ${via} text`, { askId });
    const g = groundDraft(text, corpus, names, guard);
    for (const s of g.stripped) log.warn(`${askId} grounding ${variant}: STRIPPED ${s.field} sentence (${s.why}${s.names.length ? `: ${s.names.join(", ")}` : ""}): "${s.sentence}"`, { askId, variant });
    let fellBack = false;
    let out = g.text;
    if (!out.body.trim()) {
      // Every sentence named something unknown: use the demo lines, which are built from the input alone.
      const f = groundDraft(fallback[variant], corpus, names, guard);
      out = f.text;
      fellBack = true;
      log.branch(`${askId} grounding ${variant}: use the demo lines`, `nothing was left of the ${via} body after the check`, { askId });
    }
    if (!out.subject.trim()) out = { ...out, subject: fallback[variant].subject };
    const words = wordCount(out.body);
    if (g.ok) log.info(`${askId} grounding ${variant} ok via=${via}: every name is in the input (${g.checkedNames} names checked), ${words} words`, { askId });
    else log.info(`${askId} grounding ${variant} via=${via}: ${g.stripped.length} sentence(s) stripped${fellBack ? ", fell back to the demo lines" : ""}, ${words} words left`, { askId });
    finals[variant] = out;
    grounding[variant] = { ok: g.ok, stripped: g.stripped, fellBack, words };
  }

  const summary: DraftSummary = {
    version: 1,
    draftedAt: wallNow().toISOString(),
    recipient: { id: rec.id, name: rec.name, firstName: first(rec.name), slackHandle: rec.slackHandle, email: rec.email, title: rec.title, team: rec.team },
    input,
    suggested,
    recommendationTarget: recTarget,
    via,
    source: r.source,
    note: r.source === "live" ? null : r.note,
    grounding,
    scrub,
    clock: { now: now.toISOString(), pinned: clock.pinned },
  };
  const source = via === "model" ? "live" : via === "demo" ? "demo" : "template";
  await getDb().transaction(async (tx) => {
    // A redraft (shortlist -> drafting again) replaces the earlier drafts.
    await qIn(tx, "ask.draft.clear", (h) => h.delete(t.askMessages).where(eq(t.askMessages.askId, askId)));
    await qIn(tx, "ask.draft.insert", (h) =>
      h.insert(t.askMessages).values(
        DRAFT_VARIANTS.map((variant) => ({
          askId,
          recipientId: rec.id,
          channel: format.format,
          variant,
          subject: finals[variant].subject,
          body: finals[variant].body,
          originalSubject: finals[variant].subject,
          originalBody: finals[variant].body,
          source,
          slotStart: variant === "call" && slot ? new Date(slot.start) : null,
          slotEnd: variant === "call" && slot ? new Date(slot.end) : null,
        })),
      ),
    );
    await qIn(tx, "ask.draft.summary", (h) => h.update(t.asks).set({ draft: summary }).where(eq(t.asks.id, askId)));
  });

  const strippedTotal = DRAFT_VARIANTS.reduce((n, x) => n + grounding[x].stripped.length, 0);
  await progress(strippedTotal ? `removed ${strippedTotal} sentence${strippedTotal === 1 ? "" : "s"} that named something you did not mention` : `3 drafts ready for ${first(rec.name)}, every name checked`);
  return {
    to: "ready",
    reason: `drafted 3 variants for ${rec.id} via=${via}; suggested ${VARIANT_DEF[v.variant].label} as ${format.format}; grounding ${DRAFT_VARIANTS.map((x) => `${x}=${grounding[x].ok ? "ok" : `stripped ${grounding[x].stripped.length}`}`).join(" ")}`,
    data: { recipientId: rec.id, via, suggested: v.variant, format: format.format, stripped: strippedTotal },
  };
}

const EVIDENCE_ORDER: Record<string, number> = { owner: 0, answered: 1, project: 2, author: 3, skill: 4, profile: 5 };
