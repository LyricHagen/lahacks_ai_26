import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createLogger } from "@/lib/log";
import { getProfile, nextStep } from "@/lib/onboarding";
import { withPage } from "@/lib/request-context";

const log = createLogger("page.onboarding");

/** /onboarding has no screen of its own: it sends you to the first step not done yet. */
export default async function Page() {
  return withPage("onboarding", async () => {
    const user = await requireUser("/onboarding");
    const next = nextStep(await getProfile(user.id));
    log.branch(`redirect to /onboarding/${next ?? "role"}`, next ? `${next} is the first step not done` : "onboarding is complete, showing the first step for review");
    redirect(`/onboarding/${next ?? "role"}`);
  });
}
