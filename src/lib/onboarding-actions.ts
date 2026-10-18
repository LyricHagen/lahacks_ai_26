import "server-only";
// Server action bodies for /onboarding. src/app/onboarding/actions.ts re-exports them.

import { getSessionUser, type SessionUser } from "./auth";
import { AppError } from "./errors";
import { createLogger } from "./log";
import { confirmRole, type OnboardingStep, ONBOARDING_STEPS, saveChannels, saveContext, skipOnboarding, switchPersona } from "./onboarding";
import { withAction } from "./request-context";

const log = createLogger("onboarding.action");

async function signedIn(what: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    log.warn(`auth decision: deny ${what} (signed out, onboarding needs an account)`);
    throw new AppError("AUTH_REQUIRED", undefined, { status: 401 });
  }
  return user;
}

export const switchPersonaAction = withAction("onboarding.persona", async (input: { employeeId: string }) => {
  const user = await signedIn("persona switch");
  return switchPersona(user, String(input.employeeId ?? ""));
});

export const confirmRoleAction = withAction("onboarding.role", async () => {
  const user = await signedIn("confirm role");
  await confirmRole(user);
  return { next: "/onboarding/context" };
});

export const saveContextAction = withAction("onboarding.context", async (input: { knownSkillIds: string[]; firstFocus: string }) => {
  const user = await signedIn("save context");
  const r = await saveContext(user, input);
  return { ...r, next: "/onboarding/channels" };
});

export const saveChannelsAction = withAction("onboarding.channels", async (input: { preferredChannel: string; okToInterruptSeniors: boolean }) => {
  const user = await signedIn("save channels");
  await saveChannels(user, input);
  return { next: "/dashboard" };
});

export const skipOnboardingAction = withAction("onboarding.skip", async (input: { step: OnboardingStep | "rest" }) => {
  const user = await signedIn("skip onboarding");
  if (input.step !== "rest" && !ONBOARDING_STEPS.includes(input.step)) throw new AppError("ONBOARDING_INVALID", undefined, { status: 400 });
  const r = await skipOnboarding(user, input.step);
  return { next: r.next ? `/onboarding/${r.next}` : "/dashboard" };
});
