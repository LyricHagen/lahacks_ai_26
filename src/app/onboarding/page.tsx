import { StubPage } from "@/components/stub-page";

export const metadata = { title: "Set up your profile" };

export default function Page() {
  return (
    <StubPage
      name="onboarding"
      path="/onboarding"
      title="Set up your profile"
      prompt={4}
      shape="form"
      summary="Tell Who2Ask your team, role, start date and what you are working on, so it can rank people for you."
    />
  );
}
