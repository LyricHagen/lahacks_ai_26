import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { Container, PageHeader } from "@/components/page-header";
import { getSessionUser } from "@/lib/auth";
import { createLogger } from "@/lib/log";
import { withPage } from "@/lib/request-context";

export const metadata = { title: "Sign up" };

const log = createLogger("page.signup");

export default async function Page() {
  return withPage("signup", async () => {
    const user = await getSessionUser();
    if (user) {
      log.info(`auth decision: already signed in as ${user.id}, redirect to /account`, { userId: user.id });
      redirect("/account");
    }
    return (
      <Container className="max-w-md">
        <PageHeader
          eyebrow="/signup"
          title="Sign up"
          description="You get a persona inside the synthetic company, with a team and a manager. Live model access needs an admin to approve the account; until then everything runs in demo mode."
        />
        <AuthForm kind="signup" />
        <p className="mt-8 text-[13px] text-muted">
          Your password is stored only as a bcrypt hash. See the <Link href="/privacy">privacy policy</Link>.
        </p>
      </Container>
    );
  });
}
