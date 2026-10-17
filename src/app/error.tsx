"use client";

import { useEffect } from "react";
import { Container } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { createLogger } from "@/lib/client-log";

const log = createLogger("page.error");

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    log.error("route error boundary caught a render error", { err: error, digest: error.digest, path: window.location.pathname });
  }, [error]);

  return (
    <Container>
      <ErrorState
        title="This page failed to render"
        code="CLIENT_RENDER"
        reqId={error.digest ? `digest ${error.digest}` : null}
        body="The full error with stack is in the debug log (ctrl+`)."
        action={
          <Button variant="secondary" onClick={reset}>
            Try again
          </Button>
        }
      />
    </Container>
  );
}
