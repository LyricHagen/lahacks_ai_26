import { notFound } from "next/navigation";
import { DraftWorkspace } from "@/components/draft/draft-workspace";
import { isDraftVariant, VARIANT_DEF } from "@/lib/draft";
import { createLogger } from "@/lib/log";
import { withPage } from "@/lib/request-context";

const log = createLogger("page.ask.draft.variant");

export async function generateMetadata({ params }: { params: Promise<{ variant: string }> }) {
  const { variant } = await params;
  return { title: isDraftVariant(variant) ? `Draft: ${VARIANT_DEF[variant].label}` : "Draft message" };
}

/** One variant of the draft. The layout loads the ask and holds the editor state. */
export default async function Page({ params }: { params: Promise<{ askId: string; variant: string }> }) {
  const { askId, variant } = await params;
  return withPage("ask.draft.variant", async () => {
    if (!isDraftVariant(variant)) {
      log.branch("render 404", `${variant} is not a draft variant (short, full, call)`, { askId });
      notFound();
    }
    log.info(`${askId} draft variant ${variant} viewed`, { askId, variant });
    return <DraftWorkspace variant={variant} />;
  });
}
