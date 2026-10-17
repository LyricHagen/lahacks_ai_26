import { StubPage } from "@/components/stub-page";

export const metadata = { title: "Ask" };

export default async function Page({ params }: { params: Promise<{ askId: string }> }) {
  const { askId } = await params;
  return (
    <StubPage
      name="ask.detail"
      path={`/ask/${askId}`}
      title="Ask"
      prompt={6}
      shape="card"
      params={{ askId }}
      summary="The shortlist of people for this ask, why each one was ranked where they are, their availability, and the status of your message."
    />
  );
}
