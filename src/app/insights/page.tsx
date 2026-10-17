import { StubPage } from "@/components/stub-page";

export const metadata = { title: "Insights" };

export default function Page() {
  return (
    <StubPage
      name="insights"
      path="/insights"
      title="Insights"
      prompt={10}
      shape="card"
      summary="Aggregate, anonymized view for managers: what new hires ask about, and who absorbs the load."
    />
  );
}
