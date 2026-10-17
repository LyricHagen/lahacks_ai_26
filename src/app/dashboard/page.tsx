import { StubPage } from "@/components/stub-page";

export const metadata = { title: "Dashboard" };

export default function Page() {
  return (
    <StubPage
      name="dashboard"
      path="/dashboard"
      title="Dashboard"
      prompt={8}
      shape="card"
      summary="Your open asks, people you have contacted, and this week's ramp items."
    />
  );
}
