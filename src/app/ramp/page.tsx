import { StubPage } from "@/components/stub-page";

export const metadata = { title: "Ramp plan" };

export default function Page() {
  return (
    <StubPage
      name="ramp"
      path="/ramp"
      title="Ramp plan"
      prompt={9}
      shape="card"
      summary="A weekly plan of people to meet and things to learn, built from your role and your asks."
    />
  );
}
