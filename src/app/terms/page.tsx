import { DocLayout } from "@/components/doc-layout";
import { createLogger } from "@/lib/log";
import { withPage } from "@/lib/request-context";

export const metadata = { title: "Terms" };

const log = createLogger("page.terms");

export default async function TermsPage() {
  return withPage("terms", async () => {
    log.debug("rendering terms");
    return (
      <DocLayout eyebrow="/terms" title="Terms of use" description="Last updated 17 October 2026.">
        <h2>What this is</h2>
        <p>
          Who2Ask is a hackathon prototype. It suggests which colleague in a synthetic company might help with a problem, explains the
          suggestion, and drafts a message. It is offered as is, for demonstration, with no guarantee that it works or that its suggestions are
          right.
        </p>

        <h2>Accounts</h2>
        <p>
          You need an account to make asks. New accounts wait for an admin to approve them. Keep your password to yourself; you are responsible
          for what happens under your account.
        </p>

        <h2>Acceptable use</h2>
        <ul>
          <li>Do not enter real confidential, personal or customer information. The company in the app is synthetic and so should your asks be.</li>
          <li>Do not try to extract other users&apos; data, probe for secrets, or overload the service.</li>
          <li>Do not use drafted messages to impersonate anyone.</li>
        </ul>

        <h2>You send every message</h2>
        <p>
          Who2Ask never contacts anyone. Drafts are suggestions: read them, change them, and decide whether to send them. What you send is your
          responsibility.
        </p>

        <h2>Suggestions can be wrong</h2>
        <p>
          Rankings and explanations come from a language model and from synthetic records. They can be incomplete or mistaken. When the evidence
          is thin the app says so; treat every suggestion as a starting point, and check with your manager when it matters.
        </p>

        <h2>Changes and shutdown</h2>
        <p>
          The prototype may change, reset its synthetic data, or go offline at any time. Regenerating the synthetic company replaces all directory
          data; your own asks may be cleared with it.
        </p>

        <h2>Privacy</h2>
        <p>
          How your data is handled is described in the <a href="/privacy">privacy policy</a>.
        </p>
      </DocLayout>
    );
  });
}
