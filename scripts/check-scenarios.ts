// pnpm seed:check
// Offline sanity check of the committed fixture against its planted scenarios. For each scenario
// question it embeds the question, ranks people, services and documents by cosine similarity
// alone (no ownership, load or availability), and logs where the expected answer and the traps
// land. A trap ranking above the expected person here is the point: it is what the real ranker
// has to fix with ownership, load balancing and availability.

import "./lib/env";
import { cosine, embedText } from "@/lib/embed";
import { createLogger } from "@/lib/log";
import { readFixture } from "@/seed/fixture";
import { runScript } from "./lib/run";

const log = createLogger("seed.check");

await runScript("seed-check", async () => {
  const c = await readFixture();
  if (!c) throw new Error("fixtures/company.json not found; run pnpm fixture:generate");
  const name = new Map(c.employees.map((e) => [e.id, e.name]));
  for (const sc of c.scenarios) {
    const v = embedText(sc.question);
    const people = c.employees.map((e) => ({ id: e.id, s: cosine(v, e.embedding) })).sort((a, b) => b.s - a.s);
    const rankOf = (id: string) => people.findIndex((p) => p.id === id) + 1;
    const svc = c.services.map((x) => ({ id: x.id, s: cosine(v, x.embedding) })).sort((a, b) => b.s - a.s);
    const docs = c.documents.map((d) => ({ id: d.id, s: cosine(v, d.embedding) })).sort((a, b) => b.s - a.s);
    const ctx = {
      topPeople: people.slice(0, 5).map((p) => `${p.id} ${name.get(p.id)} ${p.s.toFixed(3)}`),
      topService: `${svc[0].id} ${svc[0].s.toFixed(3)}`,
      serviceHit: svc[0].id === sc.serviceId,
      topDoc: `${docs[0].id} ${docs[0].s.toFixed(3)}`,
    };
    if (sc.expectId === "doc") {
      const docRank = docs.findIndex((d) => d.id === sc.docId) + 1;
      log.info(`${sc.id}: expected doc ${sc.docId} is #${docRank} of ${docs.length} documents`, ctx);
    } else {
      log.info(`${sc.id}: expected ${sc.expectId} is #${rankOf(sc.expectId)} by similarity alone`, {
        traps: sc.trapIds.map((id) => `${id} #${rankOf(id)}`),
        ...ctx,
      });
    }
  }
});
