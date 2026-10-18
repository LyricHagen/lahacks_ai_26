"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme";
import { cn } from "./ui/cn";

export type HeaderSession = {
  signedIn: boolean;
  email: string | null;
  isAdmin: boolean;
  mode: "live" | "demo";
  /** Plain words, from MODE_REASON_LABEL. */
  modeReason: string;
};

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/ask/new", label: "Ask", match: "/ask" },
  { href: "/directory", label: "Directory" },
  { href: "/ramp", label: "Ramp" },
  { href: "/insights", label: "Insights" },
  { href: "/demo", label: "Demo" },
  { href: "/admin/users", label: "Admin", match: "/admin" },
];

/** Quiet text label, not a pill: "Demo mode" or "Live mode", with the reason on hover and on /account. */
function ModeLabel({ s }: { s: HeaderSession }) {
  return (
    <Link
      href={s.signedIn ? "/account#mode" : "/login"}
      title={`${s.mode === "live" ? "Live" : "Demo"} mode: ${s.modeReason}`}
      className="font-mono text-[12px] text-muted no-underline hover:text-fg whitespace-nowrap"
    >
      {s.mode === "live" ? "Live mode" : "Demo mode"}
    </Link>
  );
}

function AccountLinks({ s }: { s: HeaderSession }) {
  if (s.signedIn) {
    return (
      <Link href="/account" className="text-sm text-muted hover:text-fg no-underline max-w-[12rem] truncate" title={s.email ?? undefined}>
        Account
      </Link>
    );
  }
  return (
    <>
      <Link href="/login" className="text-sm text-muted hover:text-fg no-underline">
        Log in
      </Link>
      <Link href="/signup" className="text-sm text-muted hover:text-fg no-underline">
        Sign up
      </Link>
    </>
  );
}

export function SiteHeader({ session }: { session: HeaderSession }) {
  const pathname = usePathname();
  const nav = NAV.filter((n) => n.href !== "/admin/users" || session.isAdmin);
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 h-14">
        <Link href="/" className="flex items-center gap-2 no-underline shrink-0" aria-label="Altostratus home">
          <Image src="/logo.png" alt="" width={36} height={24} priority className="h-6 w-9 object-contain" />
          <span className="font-semibold tracking-tight">Altostratus</span>
        </Link>
        <nav aria-label="Main" className="flex-1 min-w-0 overflow-x-auto">
          <ul className="flex items-center gap-0.5">
            {nav.map((n) => {
              const active = pathname === n.href || pathname.startsWith((n.match ?? n.href) + "/") || pathname === n.match;
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block px-2.5 py-1.5 text-sm no-underline whitespace-nowrap",
                      active ? "text-fg font-semibold underline underline-offset-[6px] decoration-2 decoration-accent" : "text-muted hover:text-fg",
                    )}
                  >
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="hidden sm:flex items-center gap-3 shrink-0">
          <ModeLabel s={session} />
          <ThemeToggle />
          <AccountLinks s={session} />
        </div>
      </div>
      <div className="flex sm:hidden items-center justify-between gap-3 border-t border-line px-4 py-2">
        <ThemeToggle />
        <div className="flex items-center gap-3">
          <ModeLabel s={session} />
          <AccountLinks s={session} />
        </div>
      </div>
    </header>
  );
}
