import { requireUser } from "@/lib/auth";
import { createLogger } from "@/lib/log";
import { contextDefaults, FOCUS_MAX, getProfile, listSkillsByCategory } from "@/lib/onboarding";
import { withPage } from "@/lib/request-context";
import { OnboardingFrame } from "../frame";
import { ContextForm } from "../forms";

export const metadata = { title: "What you know" };

const log = createLogger("page.onboarding.context");

export default async function Page() {
  return withPage("onboarding.context", async () => {
    const user = await requireUser("/onboarding/context");
    const [profile, groups] = await Promise.all([getProfile(user.id), listSkillsByCategory()]);
    let known = profile?.knownSkillIds ?? [];
    let focus = profile?.firstFocus ?? "";
    if (!profile?.contextAt) {
      const d = await contextDefaults(user.employeeId);
      known = d.knownSkillIds;
      focus = d.firstFocus;
      log.branch("prefill context with persona defaults", `step not saved yet (${d.why})`, { userId: user.id });
    } else {
      log.branch("prefill context with saved answers", "step was saved before", { userId: user.id });
    }
    return (
      <OnboardingFrame step="context" user={user} profile={profile} title="What you already know" description="Two questions. They shape who Who2Ask suggests and what your ramp plan covers.">
        <ContextForm groups={groups} initialKnown={known} initialFocus={focus} focusMax={FOCUS_MAX} />
      </OnboardingFrame>
    );
  });
}
