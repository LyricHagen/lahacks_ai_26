import { StubPage } from "@/components/stub-page";

export const metadata = { title: "Guided demo" };

export default function Page() {
  return (
    <StubPage
      name="demo"
      path="/demo"
      title="Guided demo"
      prompt={11}
      shape="card"
      summary="A scripted walk through one new hire's first ask, using the synthetic company."
    />
  );
}
