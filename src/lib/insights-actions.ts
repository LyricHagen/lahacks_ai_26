import "server-only";
// Server action bodies for /insights. src/app/insights/actions.ts re-exports them.

import { requireAdmin } from "./auth";
import { setOptIn } from "./insights";
import { withAction } from "./request-context";

/** Org-level opt-in for the aggregate view. Admins only, checked here as well as in the UI. */
export const setInsightsOptInAction = withAction("insights.opt_in", async (input: { on: boolean }) => {
  const admin = await requireAdmin("change the insights opt-in");
  return setOptIn(admin, input?.on === true);
});
