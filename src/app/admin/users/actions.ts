"use server";

import { approveUserAction, gateCheckAction, rejectUserAction } from "@/lib/auth-actions";

// "use server" files may only export async functions, so the wrapped actions live in src/lib/auth-actions.ts.
export async function approveUser(input: { userId: string }) {
  return approveUserAction(input);
}
export async function rejectUser(input: { userId: string }) {
  return rejectUserAction(input);
}
export async function runGateCheck() {
  return gateCheckAction(undefined);
}
