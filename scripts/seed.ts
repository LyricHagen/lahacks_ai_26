// pnpm seed [seed-string]
// Loads the synthetic company into the database (migrations must already be applied).
// With the default seed it reads fixtures/company.json: free, offline, identical every time.
// Any other seed string is generated in memory with templated text, and says so loudly.

import "./lib/env";
import { DEFAULT_SEED } from "@/seed/fixture";
import { seedDatabase } from "@/seed/load";
import { runScript } from "./lib/run";

await runScript("seed", async (args) => {
  const seed = args.find((a) => !a.startsWith("--")) ?? DEFAULT_SEED;
  await seedDatabase(seed);
});
