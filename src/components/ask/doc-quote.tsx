import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { DocCheckView } from "@/lib/ask-review";

const KIND_LABEL: Record<string, string> = { runbook: "Runbook", onboarding: "Onboarding", how_to: "How to", reference: "Reference" };

/** One offered document: title, who wrote it, why it matched, and the paragraph that reads like the answer. */
export function DocQuote({ doc, children }: { doc: DocCheckView; children?: ReactNode }) {
  return (
    <article className="border border-line bg-raised" data-doc={doc.documentId}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-3">
        <h3 className="text-[15px] font-semibold">{doc.title}</h3>
        <Badge>{KIND_LABEL[doc.kind] ?? doc.kind}</Badge>
        {doc.verdict ? <Badge tone={doc.verdict === "answered" ? "success" : "neutral"}>{doc.verdict === "answered" ? "Answered it" : "Did not answer it"}</Badge> : null}
      </header>
      <div className="grid gap-3 px-4 py-3 text-sm">
        <p className="text-[13px] text-muted">
          By <Link href={`/directory/${doc.authorId}`}>{doc.authorName}</Link>
          {doc.serviceName ? `, about ${doc.serviceName}` : ""}, updated {doc.updatedOn}. {doc.why}.{" "}
          <span className="font-mono text-[12px]">
            {doc.documentId} match {doc.score.toFixed(2)}
          </span>
        </p>
        <blockquote className="whitespace-pre-wrap border border-line bg-sunken px-4 py-3 text-[14px] leading-relaxed">{doc.section}</blockquote>
        {children}
      </div>
    </article>
  );
}
