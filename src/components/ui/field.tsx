import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

const control =
  "w-full border border-line-strong bg-raised text-fg px-3 text-sm placeholder:text-subtle " +
  "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:border-accent " +
  "disabled:opacity-50 aria-[invalid=true]:border-danger";

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cn(control, "h-10", className)} {...rest} />;
}

export function Textarea({ className, rows = 4, ...rest }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={cn(control, "py-2 leading-relaxed resize-y", className)} {...rest} />;
}

/** Native select, so it works with keyboards and screen readers for free. */
export function Select({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    <select className={cn(control, "h-10 pr-8 appearance-none bg-no-repeat cursor-pointer", className)} style={selectArrow} {...rest}>
      {children}
    </select>
  );
}

// A plain caret drawn with two borders' worth of SVG; currentColor does not work in data URIs,
// so the caret is a neutral mid gray that reads in both themes.
const selectArrow = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23888' stroke-width='1.5'/%3E%3C/svg%3E\")",
  backgroundPosition: "right 0.75rem center",
};

type FieldProps = {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Label, control, hint and error stacked. Errors are prefixed with the word "Error" (not color only). */
export function Field({ label, htmlFor, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-[13px] text-muted">{hint}</p> : null}
      {error ? (
        <p className="text-[13px] text-danger font-medium" role="alert">
          Error: {error}
        </p>
      ) : null}
    </div>
  );
}
