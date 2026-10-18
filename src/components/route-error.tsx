"use client";

// The 500 page, used by every route segment's error.tsx so one failing segment never blanks the
// app: the header, the nav and the parent layout (admin tabs, draft tabs) stay up, and only the
// failed part shows this. Server errors carry a digest (Next.js hides the message in production);
// the same digest is in the server log next to the failing request.

import { useEffect } from "react";
import { Container } from "@/components/page-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { createLogger } from "@/lib/client-log";

const log = createLogger("page.error");

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const server = !!error.digest;
  useEffect(() => {
    log.error(`route error boundary caught a ${server ? "server" : "client"} error`, { err: error, digest: error.digest, path: window.location.pathname });
  }, [error, server]);

  return (
    <Container>
      <ErrorState
        title="500: this part of the page failed"
        code={server ? "SERVER_RENDER" : "CLIENT_RENDER"}
        reqId={error.digest ? `digest ${error.digest}` : null}
        body={server ? "The server could not build this page. The digest above matches the server log line for this request." : "Something broke while drawing this page. The full error with its stack is in the debug log (ctrl+`)."}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={reset}>
              Try again
            </Button>
            <ButtonLink href="/" variant="ghost">
              Go to the landing page
            </ButtonLink>
          </div>
        }
      />
    </Container>
  );
}
