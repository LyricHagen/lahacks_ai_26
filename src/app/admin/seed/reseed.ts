import "server-only";
import { requireAdmin } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { withAction } from "@/lib/request-context";
import { seedDatabase } from "@/seed/load";

const log = createLogger("admin.seed");

export type ReseedInput = { seed: string };
export type ReseedResult = { seed: string; source: string; textSource: string; totalMs: number; counts: Record<string, number>; warnings: string[] };

export const reseedAction = withAction<ReseedInput, ReseedResult>("admin.reseed", async ({ seed }) => {
  await requireAdmin("reseed");
  const clean = (seed ?? "").trim();
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(clean)) {
    log.warn("rejected seed string", { seed: clean.slice(0, 60) });
    throw new AppError("BAD_REQUEST", "Seed must be 1 to 40 letters, digits, dots, dashes or underscores.", { status: 400 });
  }
  const s = await seedDatabase(clean);
  return { seed: s.seed, source: s.source, textSource: s.textSource, totalMs: s.totalMs, counts: s.counts, warnings: s.warnings };
});
