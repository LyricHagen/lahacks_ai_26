import type { ReactNode } from "react";
import { Container, PageHeader } from "./page-header";
import { Toc } from "./toc";

/** Long-form page: article on the left, self-building ToC on the right (top on small screens). */
export function DocLayout({ eyebrow, title, description, children }: { eyebrow: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Container>
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <div className="flex flex-col-reverse gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_15rem]">
        <article id="doc" className="prose-w2a min-w-0 [&>h2:first-child]:mt-0 [&>h2:first-child]:border-t-0 [&>h2:first-child]:pt-0">
          {children}
        </article>
        <Toc rootId="doc" className="border border-line bg-raised p-4 lg:border-0 lg:bg-transparent lg:p-0" />
      </div>
    </Container>
  );
}
