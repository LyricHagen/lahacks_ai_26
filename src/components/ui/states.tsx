import type { ReactNode } from "react";
import { cn } from "./cn";

export function EmptyState({ title, body, action, className }: { title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("border border-dashed border-line-strong px-6 py-10 text-center", className)}>
      <p className="font-semibold">{title}</p>
      {body ? <p className="mt-1 text-sm text-muted max-w-[48ch] mx-auto">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/**
 * Every error the user sees shows its code (and request id when known) so the screen can be
 * matched to the log. Search the log for the code or the request id.
 */
export function ErrorState({
  title = "Something went wrong",
  code,
  reqId,
  body,
  action,
  className,
}: {
  title?: string;
  code: string;
  reqId?: string | null;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("border border-danger bg-danger-soft px-5 py-5", className)}>
      <p className="font-semibold text-danger">Error: {title}</p>
      {body ? <p className="mt-1 text-sm text-fg">{body}</p> : null}
      <p className="mt-3 font-mono text-[12px] text-muted">
        code <span className="text-fg">{code}</span>
        {reqId ? (
          <>
            {"  "}request <span className="text-fg">{reqId}</span>
          </>
        ) : null}
      </p>
      {action ? <div className="mt-4 flex gap-2">{action}</div> : null}
    </div>
  );
}
