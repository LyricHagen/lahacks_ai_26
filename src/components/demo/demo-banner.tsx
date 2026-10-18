import Link from "next/link";
import { ResetDemoButton } from "./demo-controls";

export type DemoBannerInfo = {
  /** "Robert Barajas, Backend Engineer I on Payments" when the viewer is the demo account. */
  persona: string | null;
  canReset: boolean;
};

/**
 * The quiet line at the top of every page: the data is synthetic. It sits in the normal flow above
 * the header (never fixed or floating), so it covers nothing. Reset demo is here, on every page.
 */
export function DemoBanner({ info }: { info: DemoBannerInfo }) {
  return (
    <div role="note" aria-label="Demo data" className="border-b border-line bg-sunken" data-demo-banner>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 text-[12px] text-muted">
        <p className="min-w-0">
          Demo data: Ferndale Systems and everyone in it are made up.{info.persona ? ` You are playing ${info.persona}.` : ""}
        </p>
        <div className="ml-auto flex items-center gap-4">
          <Link href="/demo" className="text-fg">
            Guided demo
          </Link>
          {info.canReset ? <ResetDemoButton /> : null}
        </div>
      </div>
    </div>
  );
}
