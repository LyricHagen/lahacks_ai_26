import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

/** Bordered panel. Depth comes from the border and a background step, never a shadow. */
export function Card({ className, ...rest }: ComponentProps<"section">) {
  return <section className={cn("border border-line bg-raised", className)} {...rest} />;
}

export function CardHeader({ title, meta, actions, className }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn("flex items-start justify-between gap-4 border-b border-line px-4 py-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {meta ? <p className="text-[13px] text-muted mt-0.5">{meta}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </header>
  );
}

export function CardBody({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("px-4 py-4", className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: ComponentProps<"footer">) {
  return <footer className={cn("border-t border-line bg-sunken px-4 py-3 text-[13px] text-muted", className)} {...rest} />;
}
