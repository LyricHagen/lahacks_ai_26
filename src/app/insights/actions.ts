"use server";

import { setInsightsOptInAction } from "@/lib/insights-actions";

// "use server" files may only export async functions, so the wrapped action lives in src/lib/insights-actions.ts.
export async function setInsightsOptIn(input: { on: boolean }) {
  return setInsightsOptInAction(input);
}
