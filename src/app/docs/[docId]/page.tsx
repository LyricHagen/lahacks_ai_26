import Link from "next/link";
import { notFound } from "next/navigation";
import { Container, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { K_MIN_ASKS } from "@/lib/k-anon";
import { getDocument } from "@/lib/library";
import { createLogger } from "@/lib/log";
import { withPage } from "@/lib/request-context";
import { formatDay } from "@/lib/time";

const log = createLogger("page.doc");

export async function generateMetadata({ params }: { params: Promise<{ docId: string }> }) {
  const { docId } = await params;
  return { title: docId };
}

export default async function Page({ params }: { params: Promise<{ docId: string }> }) {
  return withPage("docs.detail", async () => {
    const { docId } = await params;
    const data = await getDocument(docId);
    if (!data) {
      log.branch("render 404", `no document with id ${docId}`, { code: "NOT_FOUND" });
      notFound();
    }
    const { doc, verdicts } = data;
    const paragraphs = doc.body.split(/\n\s*\n/).filter((p) => p.trim());
    log.info(`document ${doc.id} rendered: ${paragraphs.length} paragraphs`);
    return (
      <Container className="max-w-3xl">
        <PageHeader
          eyebrow={`/docs/${doc.id}`}
          title={doc.title}
          description={
            <>
              {doc.kind.replace("_", " ")} by <Link href={`/directory/${doc.authorId}`}>{doc.authorName}</Link>, updated {formatDay(doc.updatedOn)}
              {doc.serviceName ? (
                <>
                  , about <span className="font-mono">{doc.serviceName}</span> ({doc.serviceRepo})
                </>
              ) : null}
            </>
          }
        />
        <article className="flex flex-col gap-4 text-[15px] leading-relaxed">
          {paragraphs.map((p, i) => (
            <p key={i} className="whitespace-pre-line">
              {p}
            </p>
          ))}
        </article>
        <aside className="mt-10 border border-line bg-raised px-4 py-3 text-sm">
          <p className="font-semibold">When Altostratus offered this document</p>
          <p className="mt-1 text-muted">
            {verdicts.failed >= K_MIN_ASKS ? (
              <>
                <Badge tone="danger">Did not answer</Badge> <span className="font-mono">{verdicts.failed}</span> asks.{" "}
              </>
            ) : null}
            {verdicts.answered >= K_MIN_ASKS ? (
              <>
                Answered <span className="font-mono">{verdicts.answered}</span> asks.{" "}
              </>
            ) : null}
            {verdicts.failed < K_MIN_ASKS && verdicts.answered < K_MIN_ASKS ? `Not enough verdicts to show without identifying someone (fewer than ${K_MIN_ASKS}).` : null}{" "}
            <Link href="/insights#documentation-failed">All documents on /insights</Link>
          </p>
        </aside>
      </Container>
    );
  });
}
