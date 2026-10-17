import { Container, PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { createLogger, currentReqId } from "@/lib/log";
import { withPage } from "@/lib/request-context";

export const metadata = { title: "No access", robots: { index: false } };

const log = createLogger("page.denied");

/** Where src/proxy.ts sends a signed-in non-admin who opens an /admin page. */
export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string; reason?: string }> }) {
  return withPage("denied", async () => {
    const { from, reason } = await searchParams;
    log.info("rendered access denied page", { from: from ?? null, reason: reason ?? null });
    const code = reason === "role_unavailable" ? "DB_UNAVAILABLE" : "ADMIN_ONLY";
    return (
      <Container className="max-w-xl">
        <PageHeader eyebrow="/denied" title="No access" />
        <ErrorState
          title={code === "ADMIN_ONLY" ? "Only admins can open this page" : "Access could not be checked"}
          code={code}
          reqId={currentReqId()}
          body={from ? <span className="font-mono text-[13px]">{from.slice(0, 120)}</span> : undefined}
          action={<ButtonLink href="/dashboard">Go to the dashboard</ButtonLink>}
        />
      </Container>
    );
  });
}
