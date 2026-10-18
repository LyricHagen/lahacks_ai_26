"use server";

import { enterDemoAction, resetDemoAction } from "@/lib/demo-actions";

// "use server" files may only export async functions, so the wrapped actions live in src/lib/demo-actions.ts.
export async function enterDemo(input: { next?: string }) {
  return enterDemoAction(input);
}
export async function resetDemo() {
  return resetDemoAction(undefined);
}
