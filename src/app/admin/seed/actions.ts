"use server";

import { type ReseedInput, reseedAction } from "./reseed";

// "use server" files may only export async functions, so the wrapped action lives in reseed.ts.
export async function reseed(input: ReseedInput) {
  return reseedAction(input);
}
