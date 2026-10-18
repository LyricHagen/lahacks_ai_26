import { notFound, redirect } from "next/navigation";
import { asDraftSummary } from "@/lib/ask-draft-step";
import { type AskDetail, getAskDetail } from "@/lib/asks";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { withPage } from "@/lib/request-context";

export const metadata = { title: "Draft message" };

const log = createLogger("page.ask.draft");

/** /ask/[askId]/draft opens the version that was sent, or the suggested one. Without a draft the layout explains. */
export default async function Page({ params }: { params: Promise<{ askId: string }> }) {
  const { askId } = await params;
  return withPage("ask.draft.index", async () => {
    let d: AskDetail;
    try {
      d = await getAskDetail(askId);
    } catch (err) {
      // The layout renders the 404 page and logs the decision.
      if (err instanceof AppError && err.code === "ASK_NOT_FOUND") notFound();
      throw err;
    }
    const s = asDraftSummary(d.ask.draft);
    if (!s || d.ask.status === "drafting") return null;
    const v = s.sent?.variant ?? s.suggested.variant;
    log.branch(`${askId} open draft variant ${v}`, s.sent ? "the version that was sent" : `suggested: ${s.suggested.why}`, { askId });
    redirect(`/ask/${askId}/draft/${v}`);
  });
}
