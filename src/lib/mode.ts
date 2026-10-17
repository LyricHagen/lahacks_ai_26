import "server-only";
// LIVE or DEMO. resolveMode is the ONLY place that decides. It logs exactly one line per call
// that answers "why am I in demo mode":
//
//   [mode] INFO mode=demo reason=pending_user user=usr_2: account is pending approval ...
//
// grep "mode=" to see every decision. callModel (src/lib/model.ts) re-checks the same
// conditions before spending anything, so a stale decision can never cause a live call.

// Kept free of next/* imports so scripts can load it through callModel. The request-bound
// helpers (cookie, session) are in ./mode-request.ts.

import type { SessionUser } from "./auth";
import { type BudgetState, getBudgetState } from "./budget";
import { createLogger } from "./log";

const log = createLogger("mode");

export type Mode = "live" | "demo";
/** What the visitor asked for. "auto" means live if allowed. Set by the toggle on /account. */
export type RequestedMode = "auto" | "demo";

export type ModeReason =
  | "approved_user"
  | "signed_out"
  | "pending_user"
  | "rejected_user"
  | "explicit_demo"
  | "missing_api_key"
  | "user_budget_exhausted"
  | "global_budget_exhausted";

export type ResolvedMode = {
  mode: Mode;
  reason: ModeReason;
  /** Plain sentence for the UI and the log. */
  message: string;
  userId: string | null;
  requested: RequestedMode;
  budget: BudgetState | null;
};

export const MODE_COOKIE = "w2a_mode";

export function hasProviderKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function resolveMode(user: SessionUser | null, requested: RequestedMode): Promise<ResolvedMode> {
  const decide = (mode: Mode, reason: ModeReason, message: string, budget: BudgetState | null = null): ResolvedMode => {
    const r: ResolvedMode = { mode, reason, message, userId: user?.id ?? null, requested, budget };
    log.info(`mode=${mode} reason=${reason} user=${user?.id ?? "none"}: ${message}`, {
      status: user?.status ?? null,
      requested,
      hasKey: hasProviderKey(),
      ...(budget ? { userUsed: budget.userUsed, userLimit: budget.userLimit, globalUsed: budget.globalUsed, globalLimit: budget.globalLimit } : {}),
    });
    return r;
  };

  if (!user) return decide("demo", "signed_out", "not signed in, so results come from the committed demo fixtures");
  if (user.status === "rejected") return decide("demo", "rejected_user", "account was not approved, so only demo results are available");
  if (user.status !== "approved") return decide("demo", "pending_user", "account is pending approval by an admin, so results come from the demo fixtures");
  if (requested === "demo") return decide("demo", "explicit_demo", `the demo toggle is on (cookie ${MODE_COOKIE}=demo), so no model calls are made`);
  if (!hasProviderKey()) return decide("demo", "missing_api_key", "ANTHROPIC_API_KEY is not set on the server, so live calls are impossible");

  const budget = await getBudgetState(user.id);
  if (budget.userUsed !== null && budget.userUsed >= budget.userLimit) {
    return decide("demo", "user_budget_exhausted", `used ${budget.userUsed} of ${budget.userLimit} tokens today (USER_DAILY_TOKEN_BUDGET), resets at UTC midnight`, budget);
  }
  if (budget.globalUsed >= budget.globalLimit) {
    return decide("demo", "global_budget_exhausted", `everyone together used ${budget.globalUsed} of ${budget.globalLimit} tokens today (GLOBAL_DAILY_TOKEN_BUDGET), resets at UTC midnight`, budget);
  }
  return decide("live", "approved_user", `approved account, key present, ${budget.userUsed ?? 0} of ${budget.userLimit} tokens used today`, budget);
}

/** Short label for the header and notes. */
export const MODE_REASON_LABEL: Record<ModeReason, string> = {
  approved_user: "approved account",
  signed_out: "signed out",
  pending_user: "pending approval",
  rejected_user: "not approved",
  explicit_demo: "demo toggle on",
  missing_api_key: "no model key on server",
  user_budget_exhausted: "your daily budget is used up",
  global_budget_exhausted: "today's shared budget is used up",
};
