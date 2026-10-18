"use server";

import { confirmRoleAction, saveChannelsAction, saveContextAction, skipOnboardingAction, switchPersonaAction } from "@/lib/onboarding-actions";
import type { OnboardingStep } from "@/lib/onboarding";

// "use server" files may only export async functions, so the wrapped actions live in src/lib/onboarding-actions.ts.
export async function switchPersona(input: { employeeId: string }) {
  return switchPersonaAction(input);
}
export async function confirmRole() {
  return confirmRoleAction(undefined);
}
export async function saveContext(input: { knownSkillIds: string[]; firstFocus: string }) {
  return saveContextAction(input);
}
export async function saveChannels(input: { preferredChannel: string; okToInterruptSeniors: boolean }) {
  return saveChannelsAction(input);
}
export async function skipOnboarding(input: { step: OnboardingStep | "rest" }) {
  return skipOnboardingAction(input);
}
