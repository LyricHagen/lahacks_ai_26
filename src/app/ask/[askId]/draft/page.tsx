import { StubPage } from "@/components/stub-page";

export const metadata = { title: "Draft message" };

export default async function Page({ params }: { params: Promise<{ askId: string }> }) {
  const { askId } = await params;
  return (
    <StubPage
      name="ask.draft"
      path={`/ask/${askId}/draft`}
      title="Draft message"
      prompt={7}
      shape="form"
      params={{ askId }}
      summary="Edit the drafted message, then copy it and send it yourself. Who2Ask never sends anything on your behalf."
    />
  );
}
