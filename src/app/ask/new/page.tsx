import { StubPage } from "@/components/stub-page";

export const metadata = { title: "New ask" };

export default function Page() {
  return (
    <StubPage
      name="ask.new"
      path="/ask/new"
      title="New ask"
      prompt={5}
      shape="form"
      summary="Describe your problem in plain words. Who2Ask finds the people who can help."
    />
  );
}
