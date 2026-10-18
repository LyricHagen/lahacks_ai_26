"use server";

import { dismissRampItemAction, undoRampDismissalAction } from "@/lib/ramp-actions";

// "use server" files may only export async functions, so the wrapped actions live in src/lib/ramp-actions.ts.
export async function dismissRampItem(input: { weekStart: string; refId: string }) {
  return dismissRampItemAction(input);
}
export async function undoRampDismissal(input: { refId: string }) {
  return undoRampDismissalAction(input);
}
