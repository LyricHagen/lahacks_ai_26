import Link from "next/link";
import { createLogger } from "@/lib/log";
import { withPage } from "@/lib/request-context";
import { Container, PageHeader } from "./page-header";
import { SkeletonCard, SkeletonList } from "./ui/skeleton";

const log = createLogger("stub");

/**
 * Placeholder for a route that a later prompt builds. Shows the route, which prompt builds it,
 * and a skeleton of roughly the right shape so navigation works end to end.
 */
export async function StubPage({
  name,
  path,
  title,
  prompt,
  summary,
  params,
  shape = "list",
}: {
  name: string;
  path: string;
  title: string;
  prompt: number;
  summary: string;
  params?: Record<string, string>;
  shape?: "list" | "card" | "form";
}) {
  return withPage(name, async () => {
    log.info(`rendered stub for ${path}`, { prompt, ...params });
    return (
      <Container>
        <PageHeader eyebrow={path} title={title} description={summary} />
        <div className="border border-dashed border-line-strong bg-raised px-5 py-4 mb-8">
          <p className="font-semibold">Not built yet, prompt {prompt}</p>
          <p className="text-sm text-muted mt-1">
            This route exists so links and navigation work. The skeleton below shows the planned shape.
          </p>
          {params ? (
            <dl className="mt-3 font-mono text-[12px] text-muted">
              {Object.entries(params).map(([k, v]) => (
                <div key={k}>
                  <dt className="inline">{k}: </dt>
                  <dd className="inline text-fg">{v}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        {shape === "list" ? <SkeletonList count={4} /> : null}
        {shape === "card" ? (
          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <SkeletonCard lines={5} />
            <SkeletonCard lines={3} />
          </div>
        ) : null}
        {shape === "form" ? <SkeletonCard lines={4} className="max-w-md" /> : null}
        <p className="mt-8 text-sm text-muted">
          <Link href="/">Back to the landing page</Link>
        </p>
      </Container>
    );
  });
}
