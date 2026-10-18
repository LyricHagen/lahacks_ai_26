"use server";

import { linkPhoneAction, unlinkPhoneAction } from "@/lib/phone-actions";

export async function linkPhone(input: { handle: string }) {
  return linkPhoneAction(input);
}
export async function unlinkPhone() {
  return unlinkPhoneAction(undefined);
}
