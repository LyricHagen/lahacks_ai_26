import { requireUser } from "@/lib/auth";
import { createLogger } from "@/lib/log";
import { CHANNEL_LABEL, CHANNELS, getProfile } from "@/lib/onboarding";
import { withPage } from "@/lib/request-context";
import { OnboardingFrame } from "../frame";
import { ChannelsForm } from "../forms";

export const metadata = { title: "How you reach people" };

const log = createLogger("page.onboarding.channels");

const HINT: Record<(typeof CHANNELS)[number], string> = {
  slack: "Short and asynchronous. Drafts are written for a direct message.",
  email: "Longer, with a subject line. Good for people in another time zone.",
  call: "Drafts ask for a short call in a slot when the person is free.",
};

export default async function Page() {
  return withPage("onboarding.channels", async () => {
    const user = await requireUser("/onboarding/channels");
    const profile = await getProfile(user.id);
    log.debug(`channels step for ${user.id}`, { saved: !!profile?.channelsAt });
    return (
      <OnboardingFrame step="channels" user={user} profile={profile} title="How you reach people" description="Drafts follow these. You can always change the channel on a single draft.">
        <ChannelsForm
          channels={CHANNELS.map((c) => ({ id: c, label: CHANNEL_LABEL[c], hint: HINT[c] }))}
          initialChannel={profile?.preferredChannel ?? "slack"}
          initialInterrupt={profile?.okToInterruptSeniors ?? false}
        />
      </OnboardingFrame>
    );
  });
}
