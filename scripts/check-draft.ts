// pnpm draft:check
// Offline checks for prompt 8's drafting (no model, no writes):
//   1. The demo drafts for every committed composer example, sent to each owner of the asked
//      services, pass the grounding check with nothing stripped, stay under the word limit and
//      contain no dashes.
//   2. The grounding check strips what it must: a person, project, service or repo not in the
//      input, and any sentence with a protected (sensitive or confidential) string. It keeps
//      ordinary words that happen to be service names ("the web app").
//   3. firstPerson turns the second person restatement into the asker's own words.

import "./lib/env";
import understandFile from "../fixtures/demo/understand_ask.json";
import { q } from "@/db";
import * as t from "@/db/schema";
import { type DraftInput, DRAFT_VARIANTS, firstPerson, groundDraft, inputCorpus, knownNames, WORD_LIMIT, wordCount } from "@/lib/draft";
import { createLogger } from "@/lib/log";
import { demoDraft } from "@/lib/model-purposes";
import { runScript } from "./lib/run";

const log = createLogger("draft.check");

await runScript("draft-check", async () => {
  const problems: string[] = [];
  const [services, projects, people] = await Promise.all([
    q("draft.check.services", (db) => db.select({ id: t.services.id, name: t.services.name, repo: t.services.repo, primary: t.services.primaryOwnerId, secondary: t.services.secondaryOwnerId }).from(t.services)),
    q("draft.check.projects", (db) => db.select({ name: t.projects.name }).from(t.projects)),
    q("draft.check.people", (db) => db.select({ id: t.employees.id, name: t.employees.name, title: t.employees.title, team: t.employees.team, slack: t.employees.slackHandle, email: t.employees.email }).from(t.employees)),
  ]);
  const names = knownNames({ services, projects: projects.map((p) => p.name), people: people.map((p) => p.name) });
  const byId = new Map(people.map((p) => [p.id, p]));
  const asker = people[0];

  // 1. demo drafts pass their own check
  let drafts = 0;
  for (const ex of understandFile.examples) {
    const svc = services.filter((s) => ex.output.serviceIds.includes(s.id));
    for (const ownerId of [...new Set(svc.flatMap((s) => [s.primary, s.secondary]))]) {
      const rec = byId.get(ownerId);
      if (!rec) continue;
      for (const channel of ["dm", "call", "async"] as const) {
        const input: DraftInput = {
          askId: `check_${ex.exampleId}`,
          asker: { firstName: asker.name.split(" ")[0], title: asker.title, team: asker.team, daysIn: 10, zone: "Pacific", focus: null },
          recipient: { id: rec.id, firstName: rec.name.split(" ")[0], name: rec.name, title: rec.title, team: rec.team, slackHandle: rec.slack, email: rec.email, zone: "Pacific" },
          relationship: { kind: "other_team", seniority: "peer", levelsAbove: 0, sentence: `${rec.name} is on ${rec.team}.` },
          question: { restatement: ex.output.restatement, helpKind: ex.output.helpKind, services: svc.map((s) => s.name), skills: [], mentioned: ex.output.artifacts.map((a) => a.text) },
          tried: "Re-ran the job twice.",
          urgency: { key: channel === "async" ? "curious" : "blocked_now", label: channel === "async" ? "Just curious" : "Blocked now" },
          why: { evidence: [svc.some((s) => s.primary === rec.id) ? `Owns ${svc[0].name} (${svc[0].repo}).` : `Is the backup owner of ${svc[0].name} (${svc[0].repo}).`], reason: null },
          channel: { recommended: channel, rule: "check", headline: "check", format: "slack" },
          slot: channel === "call" ? { start: "2026-10-19T19:00:00Z", end: "2026-10-19T19:15:00Z", label: "Mon, Oct 19, 12:00 Pacific", soft: false } : null,
        };
        const out = demoDraft(input);
        for (const v of DRAFT_VARIANTS) {
          drafts++;
          const g = groundDraft(out[v], inputCorpus(input), names, []);
          const w = wordCount(out[v].body);
          if (!g.ok) problems.push(`${ex.exampleId} to ${rec.id} ${channel} ${v}: stripped ${JSON.stringify(g.stripped)}`);
          if (w > WORD_LIMIT) problems.push(`${ex.exampleId} ${v}: ${w} words, over ${WORD_LIMIT}`);
          if (/[\u2014\u2013]/.test(out[v].body + out[v].subject)) problems.push(`${ex.exampleId} ${v}: contains a dash`);
          if (v === "short" && out[v].body.split("\n").length > 4) problems.push(`${ex.exampleId} short: more than four lines`);
        }
      }
    }
  }
  log.info(`demo drafts: ${drafts} checked`);

  // 2. the grounding check strips what it must, and only that
  const other = people.find((p) => p.name !== asker.name)!;
  const corpus = "billing-service is mine to ask about. Sophia Mitchell";
  const cases: Array<{ text: string; strip: boolean; why: string }> = [
    { text: `Maybe ${other.name} knows.`, strip: true, why: "person not in the input" },
    { text: `${other.name.split(" ")[0]} said so.`, strip: true, why: "first name not in the input" },
    { text: `It is part of ${projects[0].name}.`, strip: true, why: "project not in the input" },
    { text: "See ferndale/web for the code.", strip: true, why: "repo not in the input" },
    { text: "The invoice-worker queue is slow.", strip: true, why: "service not in the input" },
    { text: "My visa renewal is pending.", strip: true, why: "protected text" },
    { text: "Hi Sophia, it is about billing-service.", strip: false, why: "names from the input" },
    { text: "The web app shows it twice.", strip: false, why: "ordinary word that is also a service name" },
  ];
  for (const c of cases) {
    const g = groundDraft({ subject: "", body: c.text }, corpus, names, ["visa renewal"]);
    if (g.ok === c.strip) problems.push(`grounding "${c.text}" (${c.why}): expected ${c.strip ? "stripped" : "kept"}, got ${g.ok ? "kept" : `stripped ${JSON.stringify(g.stripped[0]?.names)}`}`);
  }
  log.info(`grounding cases: ${cases.length} checked`);

  // 3. first person
  const fp: Array<[string, string]> = [
    ["You want to find where billing-service deduplicates events.", "I want to find where billing-service deduplicates events."],
    ["You need someone to explain why your deploy fails.", "I need someone to explain why my deploy fails."],
  ];
  for (const [inp, want] of fp) if (firstPerson(inp) !== want) problems.push(`firstPerson("${inp}") = "${firstPerson(inp)}", want "${want}"`);

  if (problems.length) {
    for (const p of problems) log.error(`PROBLEM ${p}`);
    log.error(`draft:check found ${problems.length} problem(s)`);
    process.exitCode = 1;
  } else log.info(`draft:check ok: ${drafts} demo drafts grounded, ${cases.length} grounding cases, ${fp.length} first person cases`);
});
