// pnpm retrieve:check
// Runs the offline half of prompt 5 against the seeded database for every planted scenario and
// every composer example: demo understanding (committed fixture or keyword extractor, never a
// model call), the document check, and the five retrieval paths. For each it logs whether the
// expected document was offered, whether the expected person is among the candidates and which
// paths brought them in, and where the traps landed. Nothing is written to the database.
//
// It reads the scenario table from fixtures/company.json; the app itself never does.

import "./lib/env";
import { eq } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { buildUnderstanding, loadCatalog } from "@/lib/understand-build";
import { DOC_MIN_SCORE, findDocs } from "@/lib/doc-check";
import { embedText } from "@/lib/embed";
import { demoClock } from "@/lib/clock-server";
import { createLogger } from "@/lib/log";
import { understandFixture } from "@/lib/model-purposes";
import { retrieveCandidates } from "@/lib/retrieve";
import { readFixture } from "@/seed/fixture";
import { runScript } from "./lib/run";

const log = createLogger("retrieve.check");

const EXAMPLES = [
  "My deploy of invoice-worker to staging fails at the Helm upgrade step with \"context deadline exceeded\". The new pods never become ready and the release rolls back. Who can help me figure out why?",
  "A staging shipper got charged twice when a Stripe webhook retried. Where does billing-service check for duplicate events, and who knows that code?",
  "My manager asked me to check why the numbers in the weekly revenue report look off. My salary review is next week so I want to get this right.",
];

await runScript("retrieve-check", async () => {
  const c = await readFixture();
  if (!c) throw new Error("fixtures/company.json not found");
  const catalog = await loadCatalog();
  const [planted] = await q("retrieve.check.planted", (db) => db.select({ value: t.appMeta.value }).from(t.appMeta).where(eq(t.appMeta.key, "seed.planted")));
  const asker = (JSON.parse(planted?.value ?? "[]") as Array<{ id: string; planted: string }>).find((p) => p.planted === "newhire_web")?.id ?? null;
  const { now } = await demoClock("retrieve:check runs at the demo instant");
  let problems = 0;
  const cases = [...c.scenarios.map((s) => ({ id: s.id, text: s.question, sc: s })), ...EXAMPLES.map((text, i) => ({ id: `example_${i + 1}`, text, sc: null }))];
  for (const k of cases) {
    const f = understandFixture({ askId: k.id, text: k.text, catalog });
    const u = buildUnderstanding({ label: k.id, text: k.text, catalog, output: f.output, via: f.via, note: null, askUrgency: "blocked_today" });
    const embedding = embedText(k.text);
    const docs = await findDocs({ label: k.id, text: k.text, embedding, understanding: u });
    const { candidates, summary } = await retrieveCandidates({ label: k.id, text: k.text, understanding: u, embedding, askerId: asker, now });
    const ctx = {
      via: f.via,
      restatement: u.restatement,
      services: u.services.map((s) => s.id),
      helpKind: u.helpKind,
      docs: docs.hits.map((d) => `${d.documentId} ${d.score}`),
      paths: summary.paths.map((p) => `${p.path}=${p.people}`).join(" "),
      sensitive: u.sensitive.length,
    };
    if (!k.sc) {
      log.info(`${k.id}: ${candidates.length} candidates`, ctx);
      continue;
    }
    const sc = k.sc;
    if (sc.expectId === "doc") {
      const ok = docs.hits.some((d) => d.documentId === sc.docId);
      if (!ok) problems++;
      log.info(`${sc.id}: expected doc ${sc.docId} ${ok ? "OFFERED" : "NOT OFFERED"}`, ctx);
    } else {
      const hit = candidates.find((x) => x.employeeId === sc.expectId);
      if (!hit) problems++;
      const traps = sc.trapIds.map((id) => {
        const tc = candidates.find((x) => x.employeeId === id);
        return `${id} ${tc ? `in via ${tc.sources.join("+")}` : "out"}`;
      });
      log.info(`${sc.id}: expected ${sc.expectId} ${hit ? `IN via ${hit.sources.join("+")}` : "MISSING"}; ${candidates.length} candidates; ${docs.hits.length} docs offered (threshold ${DOC_MIN_SCORE})`, { ...ctx, traps });
    }
  }
  log.info(`${cases.length} cases, ${problems} problems`);
  if (problems) process.exitCode = 1;
});
