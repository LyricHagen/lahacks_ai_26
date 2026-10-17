import "server-only";
// Read side of /admin/seed: what is loaded, row counts, the last run, the planted scenarios.

import { inArray, like } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import { DEFAULT_SEED, type FxScenario, readFixture } from "@/seed/fixture";
import { countRows, type SeedSummary } from "@/seed/load";
import { createLogger } from "./log";

const log = createLogger("seed.status");

export async function getSeedStatus() {
  const [metaRows, counts, fixture] = await Promise.all([
    q("seedStatus.meta", (db) => db.select().from(t.appMeta).where(like(t.appMeta.key, "seed.%"))),
    countRows(),
    readFixture(),
  ]);
  const meta = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));
  const parse = <T>(key: string): T | null => {
    if (!meta[key]) return null;
    try {
      return JSON.parse(meta[key]) as T;
    } catch (err) {
      log.error(`app_meta ${key} is not valid JSON`, { err });
      return null;
    }
  };
  const summary = parse<SeedSummary>("seed.summary");
  const scenarios = parse<FxScenario[]>("seed.scenarios") ?? [];
  const planted = parse<{ id: string; planted: string }[]>("seed.planted") ?? [];

  const ids = [...new Set([...scenarios.flatMap((s) => [s.expectId, ...s.trapIds]), ...planted.map((p) => p.id)].filter((x) => x.startsWith("emp_")))];
  const people = ids.length
    ? await q("seedStatus.people", (db) => db.select({ id: t.employees.id, name: t.employees.name, team: t.employees.team }).from(t.employees).where(inArray(t.employees.id, ids)))
    : [];

  if (!meta["seed.string"]) log.branch("report unseeded database", "no seed.string in app_meta");
  else log.debug("seed status loaded", { seed: meta["seed.string"], employees: counts.employees });

  return {
    seed: meta["seed.string"] ?? null,
    meta,
    summary,
    counts,
    scenarios,
    planted,
    people: new Map(people.map((p) => [p.id, p])),
    fixture: fixture ? { seed: fixture.seed, generatedAt: fixture.generatedAt, text: fixture.text, embedding: fixture.embedding } : null,
    defaultSeed: DEFAULT_SEED,
  };
}
