import "server-only";
// Server action bodies for the guided demo. src/app/demo/actions.ts re-exports them ("use server"
// files may only export async functions).

import { AuthError } from "next-auth";
import { safeNext } from "./auth-actions";
import { getSessionUser } from "./auth";
import { signIn } from "./auth-config";
import { ensureDemoState, resetDemo } from "./demo";
import { demoStepHref } from "./demo-script";
import { AppError } from "./errors";
import { createLogger } from "./log";
import { enforceRateLimit } from "./rate-limit";
import { withAction } from "./request-context";

const log = createLogger("demo.action");

/** Signs the visitor in to the shared demo account (preparing the demo first if needed). */
export const enterDemoAction = withAction("demo.enter", async (input: { next?: string }) => {
  await enforceRateLimit("demo_enter");
  const before = await getSessionUser();
  const state = await ensureDemoState("entering the demo");
  if (before?.isDemo) {
    log.skip("demo sign in", `${before.id} is already the demo account`);
  } else {
    try {
      await signIn("demo", { redirect: false });
    } catch (err) {
      if (err instanceof AuthError) {
        log.error(`demo sign in refused by Auth.js (${err.type})`, { err });
        throw new AppError("DEMO_NOT_READY", "The demo account could not be signed in. Try Reset demo.", { status: 503 });
      }
      throw err;
    }
    log.info(`auth decision: demo sign in for ${before ? `${before.id} (signed out of their own account)` : "a signed-out visitor"} as ${state.accountId} playing ${state.personaId}`, { userId: state.accountId });
  }
  const to = safeNext(input?.next) ?? demoStepHref("ask");
  return { to, guidedAskId: state.guidedAskId };
});

/**
 * Reset demo, from the banner on any page. Allowed for the demo account, signed-out visitors
 * (their own asks are demo data too) and admins; another account would wipe demo data it does
 * not use, so it is refused.
 */
export const resetDemoAction = withAction("demo.reset", async () => {
  const user = await getSessionUser();
  if (user && !user.isDemo && user.role !== "admin") {
    log.warn(`auth decision: deny demo reset for ${user.id} (an ordinary account; only the demo account, signed-out visitors and admins may reset)`, { userId: user.id });
    throw new AppError("FORBIDDEN", "Only the demo account, signed-out visitors and admins can reset the demo.", { status: 403 });
  }
  await enforceRateLimit("demo_reset");
  const by = user ? `${user.id} (${user.isDemo ? "demo account" : "admin"})` : "a signed-out visitor";
  const r = await resetDemo(by);
  return {
    ms: r.ms,
    deletedAsks: r.deleted.asks,
    loadsChanged: r.loads.length,
    guidedAskId: r.guidedAskId,
    clock: r.clock,
    to: user?.isDemo ? demoStepHref("ask") : "/demo",
  };
});
