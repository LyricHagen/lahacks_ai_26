import "server-only";
// Server action bodies for accounts and mode. The "use server" files in src/app re-export these
// (a "use server" file may only export async functions). Every outcome logs one decision line.

import { eq } from "drizzle-orm";
import { AuthError } from "next-auth";
import { cookies } from "next/headers";
import { q } from "@/db";
import * as t from "@/db/schema";
import { createAccount, normalizeEmail, setUserStatus } from "./accounts";
import { getSessionUser, requireAdmin } from "./auth";
import { signIn, signOut } from "./auth-config";
import { AppError } from "./errors";
import { createLogger } from "./log";
import { MODE_COOKIE } from "./mode";
import { currentMode } from "./mode-request";
import { callModel } from "./model";
import { needsOnboarding } from "./onboarding";
import { enforceRateLimit } from "./rate-limit";
import { withAction } from "./request-context";

const log = createLogger("auth.action");

/** Only same-site relative paths, so ?next= cannot send someone to another origin. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}

async function startSession(email: string, password: string): Promise<void> {
  let url: string | undefined;
  try {
    url = (await signIn("credentials", { email, password, redirect: false })) as string | undefined;
  } catch (err) {
    if (err instanceof AuthError) {
      log.info(`sign in refused by Auth.js (${err.type})`);
      throw new AppError("AUTH_INVALID_CREDENTIALS", undefined, { status: 401 });
    }
    throw err;
  }
  if (url && /[?&]error=/.test(url)) {
    log.info("sign in refused by Auth.js (error in callback url)", { url: url.replace(/^https?:\/\/[^/]+/, "") });
    throw new AppError("AUTH_INVALID_CREDENTIALS", undefined, { status: 401 });
  }
}

function destinationFor(status: string, role: string, next: string | null, onboard: boolean): { to: string; why: string } {
  if (status === "rejected") return { to: "/pending", why: "account was rejected" };
  if (next) return { to: next, why: `${status}, returning to the page that sent them to login` };
  // Shown once: on first use (pending accounts work in demo mode meanwhile) and after approval.
  if (onboard) return { to: "/onboarding/role", why: `${status}, onboarding not finished or skipped yet` };
  if (status === "pending") return { to: "/pending", why: "account is pending approval" };
  if (role === "admin") return { to: "/admin/users", why: "approved admin, no next page" };
  return { to: "/dashboard", why: "approved, no next page" };
}

export const loginAction = withAction("auth.login", async (input: { email: string; password: string; next?: string }) => {
  await enforceRateLimit("login");
  const email = normalizeEmail(input.email ?? "");
  await startSession(email, input.password ?? "");
  const [row] = await q("auth.login.after", (db) => db.select({ id: t.users.id, status: t.users.status, role: t.users.role }).from(t.users).where(eq(t.users.email, email)).limit(1));
  const { to, why } = destinationFor(row.status, row.role, safeNext(input.next), await needsOnboarding(row.id));
  log.info(`auth decision: login ok for ${row.id} (status ${row.status}, role ${row.role}), send to ${to} because ${why}`, { userId: row.id });
  return { to, status: row.status };
});

export const signupAction = withAction("auth.signup", async (input: { email: string; password: string }) => {
  await enforceRateLimit("signup");
  const created = await createAccount(input.email ?? "", input.password ?? "");
  await startSession(created.email, input.password);
  const { to, why } = destinationFor(created.status, created.role, null, true);
  log.info(`auth decision: signup ok for ${created.id} (status ${created.status}, role ${created.role}), send to ${to} because ${why}`, { userId: created.id });
  return { to, status: created.status, role: created.role, adminReason: created.adminReason, personaId: created.persona?.id ?? null };
});

export const logoutAction = withAction("auth.logout", async () => {
  const user = await getSessionUser();
  await signOut({ redirect: false });
  log.info(`auth decision: signed out ${user?.id ?? "(no session)"}`, { userId: user?.id ?? null });
  return { to: "/" };
});

/** The demo toggle. demo=true forces demo mode for this browser even for an approved account. */
export const setDemoToggleAction = withAction("mode.toggle", async (input: { demo: boolean }) => {
  const user = await getSessionUser();
  const jar = await cookies();
  if (input.demo) {
    jar.set(MODE_COOKIE, "demo", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 24 * 60 * 60 });
  } else {
    jar.delete(MODE_COOKIE);
  }
  log.info(`demo toggle ${input.demo ? "ON" : "OFF"} for ${user?.id ?? "signed-out visitor"}`, { userId: user?.id ?? null });
  return { demo: input.demo };
});

export const approveUserAction = withAction("admin.users.approve", async (input: { userId: string }) => {
  const admin = await requireAdmin("approve account");
  return setUserStatus(admin, input.userId, "approved");
});

export const rejectUserAction = withAction("admin.users.reject", async (input: { userId: string }) => {
  const admin = await requireAdmin("reject account");
  return setUserStatus(admin, input.userId, "rejected");
});

/** One gate_check call through callModel, from /admin/usage. Shows the gate working end to end. */
export const gateCheckAction = withAction("admin.gate_check", async () => {
  const user = await requireAdmin("gate check");
  const mode = await currentMode();
  const r = await callModel({ purpose: "gate_check", input: {}, user, mode });
  return {
    source: r.source,
    outcome: r.outcome,
    mode: mode.mode,
    modeReason: mode.reason,
    reply: r.output?.reply ?? null,
    note: r.source === "live" ? null : r.note,
    tokens: r.source === "live" ? r.usage.inputTokens + r.usage.outputTokens : 0,
    costUsd: r.source === "live" ? r.costUsd : 0,
  };
});
