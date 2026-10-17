import { NotFoundLogger } from "@/components/not-found-logger";
import { Container } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export default function NotFound() {
  return (
    <Container>
      <NotFoundLogger />
      <EmptyState
        title="Page not found"
        body="Nothing lives at this address. Code NOT_FOUND."
        action={<ButtonLink href="/">Go to the landing page</ButtonLink>}
      />
    </Container>
  );
}
