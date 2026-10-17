import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 border font-medium whitespace-nowrap select-none " +
  "disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg border-accent hover:bg-fg hover:border-fg hover:text-bg active:opacity-80",
  secondary: "bg-raised text-fg border-line-strong hover:bg-sunken active:bg-strong",
  ghost: "bg-transparent text-fg border-transparent hover:bg-sunken active:bg-strong",
  danger: "bg-raised text-danger border-danger font-semibold hover:bg-danger-soft active:bg-strong",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

type ButtonProps = ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize };

export function Button({ variant = "secondary", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize };

/** A link styled as a button. Use for navigation so every destination keeps a real URL. */
export function ButtonLink({ variant = "secondary", size = "md", className, ...rest }: ButtonLinkProps) {
  return <Link className={buttonClass(variant, size, cn("no-underline", className))} {...rest} />;
}
