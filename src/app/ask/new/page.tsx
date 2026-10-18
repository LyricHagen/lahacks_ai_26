import Link from "next/link";
import { Container, PageHeader } from "@/components/page-header";
import { getPersonaSummary } from "@/lib/accounts";
import { getAskExamples } from "@/lib/ask-examples";
import { ASK_BODY_MAX, ASK_BODY_MIN, ASK_EXTRA_MAX, SCREENSHOT_MAX_BYTES } from "@/lib/asks";
import { flagOn } from "@/lib/flags";
import { createLogger } from "@/lib/log";
import { MODE_REASON_LABEL } from "@/lib/mode";
import { currentMode } from "@/lib/mode-request";
import { withPage } from "@/lib/request-context";
import { getViewer } from "@/lib/viewer";
import { Composer } from "./composer";

export const metadata = { title: "New ask" };

const log = createLogger("page.ask.new");

export default async function Page() {
  return withPage("ask.new", async () => {
    const viewer = await getViewer();
    const [examples, persona, mode] = await Promise.all([getAskExamples(), getPersonaSummary(viewer.personaId), currentMode()]);
    const screenshot = flagOn("stepfun_vision", "the composer's screenshot field");
    log.info(`composer for ${viewer.actorId} as ${persona?.id ?? "no persona"}`, { examples: examples.length, mode: mode.mode, screenshotField: screenshot });
    return (
      <Container className="max-w-3xl">
        <PageHeader
          eyebrow="/ask/new"
          title="What are you stuck on?"
          description="Write it the way you would say it to a teammate. Altostratus finds the right person, says why, checks when they are free and drafts the message. You send it yourself."
        />
        <p className="mb-6 text-sm text-muted">
          Asking as{" "}
          {persona ? (
            <>
              <Link href={`/directory/${persona.id}`}>{persona.name}</Link>, {persona.title}, {persona.team}
            </>
          ) : (
            "nobody yet (the company is not seeded)"
          )}
          {viewer.user ? null : (
            <>
              {" "}
              (the demo persona; <Link href="/signup">sign up</Link> to get your own)
            </>
          )}
          . <span className="font-mono text-[12px]">{mode.mode === "live" ? "Live mode" : "Demo mode"}</span>
          <span className="text-subtle"> ({MODE_REASON_LABEL[mode.reason]})</span>
        </p>
        <Composer examples={examples} limits={{ bodyMin: ASK_BODY_MIN, bodyMax: ASK_BODY_MAX, extraMax: ASK_EXTRA_MAX, screenshotBytes: SCREENSHOT_MAX_BYTES }} screenshot={screenshot} live={mode.mode === "live"} />
      </Container>
    );
  });
}
