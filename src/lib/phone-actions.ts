import "server-only";
// Server action bodies for Photon phone delivery (src/lib/phone.ts). src/app/account/phone-actions.ts
// and src/app/ask/actions.ts re-export them ("use server" files may only export async functions).

import { AppError } from "./errors";
import { getSessionUser } from "./auth";
import type { DraftFormat, DraftVariant } from "./draft";
import { createLogger } from "./log";
import { deliverDraft, startLink, unlink } from "./phone";
import { enforceRateLimit } from "./rate-limit";
import { withAction } from "./request-context";

const log = createLogger("phone.action");

async function signedIn(what: string) {
  const user = await getSessionUser();
  if (!user) {
    log.info(`auth decision: deny ${what} (signed out; texting a draft needs your own account and number)`);
    throw new AppError("AUTH_REQUIRED", "Sign in to text drafts to your own phone.", { status: 401 });
  }
  return user;
}

export const linkPhoneAction = withAction("phone.link", async (input: { handle: string }) => {
  const user = await signedIn("phone link");
  await enforceRateLimit("phone_link", user.id);
  return startLink(user, input.handle);
});

export const unlinkPhoneAction = withAction("phone.unlink", async () => {
  const user = await signedIn("phone unlink");
  await unlink(user, "unlinked by the account owner on /account");
  return { unlinked: true };
});

export const deliverDraftAction = withAction("phone.deliver", async (input: { askId: string; variant: DraftVariant; format: DraftFormat; subject: string; body: string }) => {
  const user = await signedIn("text draft");
  await enforceRateLimit("phone_deliver", user.id);
  return deliverDraft(user, input);
});
