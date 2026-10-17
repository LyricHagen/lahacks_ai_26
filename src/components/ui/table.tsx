import type { ComponentProps } from "react";
import { cn } from "./cn";

/** Wrapped in a scroll container so wide tables never cause page-level horizontal scroll. */
export function Table({ className, ...rest }: ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto border border-line">
      <table className={cn("w-full border-collapse text-sm", className)} {...rest} />
    </div>
  );
}

export function THead({ className, ...rest }: ComponentProps<"thead">) {
  return <thead className={cn("bg-sunken", className)} {...rest} />;
}

export function TBody(props: ComponentProps<"tbody">) {
  return <tbody {...props} />;
}

export function TR({ className, ...rest }: ComponentProps<"tr">) {
  return <tr className={cn("border-b border-line last:border-b-0", className)} {...rest} />;
}

export function TH({ className, ...rest }: ComponentProps<"th">) {
  return <th className={cn("text-left font-medium text-muted text-[13px] px-3 py-2 border-b border-line", className)} {...rest} />;
}

/** Pass mono for ids, numbers and timestamps. */
export function TD({ className, mono, ...rest }: ComponentProps<"td"> & { mono?: boolean }) {
  return <td className={cn("px-3 py-2 align-top", mono && "font-mono text-[13px]", className)} {...rest} />;
}
