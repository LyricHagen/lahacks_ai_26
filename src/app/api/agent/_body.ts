import type { NextRequest } from "next/server";
import type { z } from "zod";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/log";

const log = createLogger("agent.api");

/** Parse and validate a JSON body against a schema from AgentBodies (src/lib/inputs.ts). */
export async function agentBody<T>(req: NextRequest, schema: z.ZodType<T>, what: string): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch (err) {
    log.warn(`${what}: body is not JSON`, { err });
    throw new AppError("BAD_REQUEST", "Send a JSON body.", { status: 400 });
  }
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  log.warn(`${what}: body refused by schema: ${r.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.code}`).join(", ")}`);
  throw new AppError("BAD_REQUEST", "That request body is not in the expected shape.", { status: 400 });
}
