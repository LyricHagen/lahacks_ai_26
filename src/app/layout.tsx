import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Suspense } from "react";
import { DebugProvider } from "@/components/debug/debug-provider";
import { SiteFooter } from "@/components/site-footer";
import { type HeaderSession, SiteHeader } from "@/components/site-header";
import { themeInitScript } from "@/components/theme";
import { ToastProvider } from "@/components/ui/toast";
import { getSessionUser } from "@/lib/auth";
import { MODE_REASON_LABEL, resolveMode } from "@/lib/mode";
import { getRequestedMode } from "@/lib/mode-request";
import { withPage } from "@/lib/request-context";
import "./globals.css";

// next/font downloads the files at build time and serves them from our own origin.
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Who2Ask", template: "%s | Who2Ask" },
  description: "Find the right colleague to ask, see why, check when they are free, and draft the message. You send it yourself.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f4f1" },
    { media: "(prefers-color-scheme: dark)", color: "#151514" },
  ],
};

/** Who is signed in and which mode applies, for the header. Resolved server side on every render. */
async function headerSession(): Promise<HeaderSession> {
  return withPage("layout.header", async () => {
    const user = await getSessionUser();
    const mode = await resolveMode(user, await getRequestedMode());
    return { signedIn: !!user, email: user?.email ?? null, isAdmin: user?.role === "admin", mode: mode.mode, modeReason: MODE_REASON_LABEL[mode.reason] };
  });
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await headerSession();
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:bg-raised focus:px-3 focus:py-2 focus:border focus:border-line-strong">
          Skip to content
        </a>
        <ToastProvider>
          <SiteHeader session={session} />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
          <Suspense fallback={null}>
            <DebugProvider />
          </Suspense>
        </ToastProvider>
      </body>
    </html>
  );
}
