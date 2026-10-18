// Next.js 16 renamed middleware.ts to proxy.ts. This is the "middleware" DEBUGGING.md refers to.
// It mints the request id, forwards it to the app as a request header, returns it as
// X-Request-Id, and guards /admin: only a signed-in admin gets through. The role is read from
// the database here (proxy runs on Node.js), not trusted from the cookie, so a demotion is
// immediate. Admin pages and actions repeat the check with requireAdmin.

import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { q } from "@/db";
import * as t from "@/db/schema";
import { auth } from "@/lib/auth-config";
import { createLogger, requestStorage } from "@/lib/log";
import { shortId } from "@/lib/log-format";

const log = createLogger("http");
const alog = createLogger("auth.proxy");

function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/");
}

async function adminDecision(request: NextRequest, userId: string | undefined, reqId: string): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;
  const deny = (to: URL, reason: string, ctx: Record<string, unknown>) => {
    alog.warn(`auth decision: DENY ${request.method} ${pathname} (${reason}), redirect to ${to.pathname}${to.search}`, { path: pathname, reason, ...ctx });
    const res = NextResponse.redirect(to);
    res.headers.set("X-Request-Id", reqId);
    return res;
  };
  if (!userId) {
    const to = new URL("/login", request.url);
    to.searchParams.set("next", pathname);
    return deny(to, "signed out", {});
  }
  let row: { role: string; status: string } | undefined;
  try {
    [row] = await q("auth.proxy.role", (db) => db.select({ role: t.users.role, status: t.users.status }).from(t.users).where(eq(t.users.id, userId)).limit(1));
  } catch (err) {
    // Fail closed: if the role cannot be read, nobody gets into admin.
    alog.error("could not read the user's role, denying admin access", { err, userId });
    const to = new URL("/denied", request.url);
    to.searchParams.set("from", pathname);
    to.searchParams.set("reason", "role_unavailable");
    return deny(to, "role lookup failed", { userId });
  }
  if (!row) {
    const to = new URL("/login", request.url);
    to.searchParams.set("next", pathname);
    return deny(to, `session names ${userId} but that account no longer exists`, { userId });
  }
  if (row.role !== "admin") {
    const to = new URL("/denied", request.url);
    to.searchParams.set("from", pathname);
    to.searchParams.set("reason", "not_admin");
    return deny(to, `${userId} has role ${row.role}, needs admin`, { userId, status: row.status });
  }
  alog.info(`auth decision: allow ${request.method} ${pathname} for ${userId} (admin)`, { userId });
  return null;
}

export const proxy = auth(async (request) => {
  const incoming = request.headers.get("x-request-id");
  // Only trust a client-supplied id if it has our shape; otherwise mint a fresh one.
  const reqId = incoming && /^req_[a-f0-9]{6,32}$/.test(incoming) ? incoming : shortId("req");
  const userId = request.auth?.user?.id;

  return requestStorage.run({ reqId, startedAt: performance.now(), lines: [] }, async () => {
    const { pathname, search } = request.nextUrl;
    const isAction = request.headers.has("next-action");
    const isPrefetch = request.headers.get("next-router-prefetch") === "1" || request.headers.get("purpose") === "prefetch";
    log.info(`${request.method} ${pathname}${search}`, {
      user: userId ?? "none",
      ...(isAction ? { kind: "server-action" } : {}),
      ...(isPrefetch ? { kind: "prefetch" } : {}),
      ...(incoming && incoming !== reqId ? { ignoredIncomingId: incoming.slice(0, 40) } : {}),
    });

    if (isAdminPath(pathname) && pathname === "/admin/models" && process.env.NODE_ENV === "development") {
      alog.branch("let /admin/models through without sign in", "development server: the models page is read only and open locally (production keeps the admin check)");
    } else if (isAdminPath(pathname)) {
      const denied = await adminDecision(request, userId, reqId);
      if (denied) return denied;
    }

    const forwarded = new Headers(request.headers);
    forwarded.set("x-request-id", reqId);
    const res = NextResponse.next({ request: { headers: forwarded } });
    res.headers.set("X-Request-Id", reqId);
    return res;
  });
});

export const config = {
  // Everything except static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|logo.png|robots.txt).*)"],
};
