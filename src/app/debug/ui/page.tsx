import { UiGallery } from "@/components/debug/ui-gallery";
import { Container, PageHeader } from "@/components/page-header";

export const metadata = { title: "UI primitives" };

/** Visual check of every primitive in src/components/ui, in both themes. */
export default function UiPage() {
  return (
    <Container>
      <PageHeader eyebrow="/debug/ui" title="UI primitives" description="Every base component and the skeleton set. Switch theme in the header to check both." />
      <UiGallery />
    </Container>
  );
}
