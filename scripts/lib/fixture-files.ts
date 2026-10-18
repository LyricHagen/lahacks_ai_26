// Reads and writes fixtures/model/<purpose>.json for pnpm fixtures:record. The app only ever reads
// these files (statically imported by src/lib/model-fixtures.ts); only this module writes them.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type RecordedEntry, type RecordedFile, type RecordedPurpose, RECORDED_PURPOSES } from "@/lib/model-fixtures";

const DIR = join(process.cwd(), "fixtures", "model");
const NOTE = "Recorded live results, keyed by a hash of the normalized input. Written by pnpm fixtures:record; demo mode replays them and never calls a model.";

export async function readFixtureFile(purpose: RecordedPurpose): Promise<RecordedFile> {
  try {
    return JSON.parse(await readFile(join(DIR, `${purpose}.json`), "utf8")) as RecordedFile;
  } catch {
    return { version: 1, purpose, note: NOTE, entries: {} };
  }
}

/** Merges entries into each purpose's file (same hash: replaced), keys sorted so diffs stay small. */
export async function writeFixtureEntries(byPurpose: Partial<Record<RecordedPurpose, RecordedEntry[]>>): Promise<Record<string, { added: number; replaced: number; total: number }>> {
  const out: Record<string, { added: number; replaced: number; total: number }> = {};
  for (const purpose of RECORDED_PURPOSES) {
    const add = byPurpose[purpose] ?? [];
    if (!add.length) continue;
    const file = await readFixtureFile(purpose);
    let added = 0;
    let replaced = 0;
    for (const e of add) {
      if (file.entries[e.hash]) replaced++;
      else added++;
      file.entries[e.hash] = e;
    }
    const entries = Object.fromEntries(Object.keys(file.entries).sort().map((k) => [k, file.entries[k]]));
    await writeFile(join(DIR, `${purpose}.json`), `${JSON.stringify({ version: 1, purpose, note: NOTE, entries }, null, 2)}\n`);
    out[purpose] = { added, replaced, total: Object.keys(entries).length };
  }
  return out;
}
