import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { Container, PageHeader } from "@/components/page-header";
import { safeNext } from "@/lib/auth-actions";
import { getSessionUser } from "@/lib/auth";
import { createLogger } from "@/lib/log";
import { withPage } from "@/lib/request-context";

export const metadata = { title: "Log in" };

const log = createLogger("page.login");

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return withPage("login", async () => {
    const { next } = await searchParams;
    const user = await getSessionUser();
    if (user) {
      const to = user.status === "approved" ? (safeNext(next) ?? "/dashboard") : "/pending";
      log.info(`auth decision: already signed in as ${user.id} (status ${user.status}), redirect to ${to}`, { userId: user.id });
      redirect(to);
    }
    log.debug("rendering login form", { next: safeNext(next) });
    return (
      <Container className="max-w-md">
        <PageHeader eyebrow="/login" title="Log in" description="Everything in Who2Ask is browsable without an account. An approved account adds live model results." />
        <AuthForm kind="login" next={safeNext(next) ?? undefined} />
      </Container>
    );
  });
}
