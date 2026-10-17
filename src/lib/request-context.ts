import "server-only";
// Wrappers that open a request context (AsyncLocalStorage) and log entry, exit and errors.
//
//   API route:      export const GET = withRoute("debug.ping", async (req) => ok({ ... }));
//   Server action:  export const save = withAction("onboarding.save", async (input: X) => ({ ... }));
//   Page:           return withPage("page.dashboard", async () => <div>...</div>);
//
// The request id is minted in src/proxy.ts and forwarded as the x-request-id request header.

import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { AppError, type ErrorCode, toAppError } from "./errors";
import { createLogger, currentRequest, requestStorage, type RequestStore } from "./log";
import { shortId } from "./log-format";
import { getSessionUser } from "./auth";

export const REQUEST_ID_HEADER = "x-request-id";

const log = createLogger("ctx");

function newStore(reqId: string, method?: string, path?: string): RequestStore {
  return { reqId, method, path, startedAt: performance.now(), lines: [] };
}

async function resolveReqId(source: string): Promise<string> {
  try {
    const h = await headers();
    const id = h.get(REQUEST_ID_HEADER);
    if (id) return id;
  } catch (err) {
    // Let Next's own signals (dynamic rendering bailout, redirects) through untouched.
    unstable_rethrow(err);
    // Otherwise headers() threw because there is no request scope (scripts); handled below.
  }
  const id = shortId("req");
  // Logged inside the new context by the caller, so it shows up with the id it explains.
  pendingNotes.set(id, `no ${REQUEST_ID_HEADER} header for ${source} (proxy did not run for this path), minted ${id}`);
  return id;
}
const pendingNotes = new Map<string, string>();
function flushNote(reqId: string) {
  const note = pendingNotes.get(reqId);
  if (note) {
    pendingNotes.delete(reqId);
    log.warn(note);
  }
}

/** Whether `_debug` lines may be sent to this caller. Logs the decision. */
export async function isDebugAllowed(): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") {
    log.trace("debug output allowed", { reason: "NODE_ENV is not production" });
    return true;
  }
  const user = await getSessionUser();
  if (user?.role === "admin") {
    log.trace("debug output allowed", { reason: "signed-in user is admin", userId: user.id });
    return true;
  }
  log.trace("debug output withheld", { reason: user ? "user is not admin" : "no session" });
  return false;
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

export type ApiResult = { status?: number; body: Record<string, unknown>; headers?: Record<string, string> };

export function ok(body: Record<string, unknown>, status = 200): ApiResult {
  return { status, body };
}

export function fail(code: ErrorCode, message?: string, status = 400): never {
  throw new AppError(code, message, { status });
}

type RouteCtx<P> = { params: Promise<P> };

/**
 * Wrap a route handler. The handler returns ok({...}) (or throws). The wrapper logs exit,
 * then adds `reqId` and `_debug` to the JSON body and the X-Request-Id header.
 * Returning a raw Response is allowed for non-JSON output (downloads); it gets the header only.
 */
export function withRoute<P = Record<string, string>>(
  name: string,
  handler: (req: NextRequest, ctx: RouteCtx<P>) => Promise<ApiResult | Response>,
) {
  const rlog = createLogger(`api.${name}`);
  return async (req: NextRequest, ctx: RouteCtx<P>): Promise<Response> => {
    const reqId = req.headers.get(REQUEST_ID_HEADER) ?? (await resolveReqId(`api.${name}`));
    const store = newStore(reqId, req.method, req.nextUrl.pathname);
    return requestStorage.run(store, async () => {
      flushNote(reqId);
      rlog.info(`enter ${req.method} ${req.nextUrl.pathname}${req.nextUrl.search}`);
      let result: ApiResult | Response;
      let errorCode: ErrorCode | null = null;
      try {
        result = await handler(req, ctx);
      } catch (err) {
        const appErr = toAppError(err);
        errorCode = appErr.code;
        rlog.error(`failed with ${appErr.code}`, { err, status: appErr.status });
        result = {
          status: appErr.status,
          body: { ok: false, error: { code: appErr.code, message: appErr.message } },
        };
      }
      const ms = Math.round(performance.now() - store.startedAt);
      if (result instanceof Response) {
        rlog.info(`exit ${result.status} in ${ms}ms (raw response, no _debug)`);
        result.headers.set("X-Request-Id", reqId);
        return result;
      }
      const status = result.status ?? 200;
      rlog.info(`exit ${status} in ${ms}ms`, errorCode ? { code: errorCode } : undefined);
      const debugAllowed = await isDebugAllowed();
      const body = { ...result.body, reqId, ...(debugAllowed ? { _debug: [...store.lines] } : {}) };
      const res = NextResponse.json(body, { status, headers: result.headers });
      res.headers.set("X-Request-Id", reqId);
      return res;
    });
  };
}

// ---------------------------------------------------------------------------
// Server actions
// ---------------------------------------------------------------------------

export type ActionResult<T> =
  | { ok: true; data: T; reqId: string; _debug?: string[] }
  | { ok: false; code: ErrorCode; message: string; reqId: string; _debug?: string[] };

/** Wrap a server action. Never throws to the client: failures come back as { ok: false, code }. */
export function withAction<I, O>(name: string, fn: (input: I) => Promise<O>) {
  const alog = createLogger(`action.${name}`);
  return async (input: I): Promise<ActionResult<O>> => {
    const reqId = await resolveReqId(`action.${name}`);
    const store = newStore(reqId, "ACTION", name);
    return requestStorage.run(store, async () => {
      flushNote(reqId);
      alog.info("enter", { input: summarizeInput(input) });
      let out: ActionResult<O>;
      try {
        const data = await fn(input);
        alog.info(`exit ok in ${Math.round(performance.now() - store.startedAt)}ms`);
        out = { ok: true, data, reqId };
      } catch (err) {
        const appErr = toAppError(err);
        alog.error(`exit failed with ${appErr.code} in ${Math.round(performance.now() - store.startedAt)}ms`, { err });
        out = { ok: false, code: appErr.code, message: appErr.message, reqId };
      }
      if (await isDebugAllowed()) out._debug = [...store.lines];
      return out;
    });
  };
}

function summarizeInput(input: unknown): unknown {
  const s = JSON.stringify(input ?? null);
  return s.length > 500 ? `${s.slice(0, 500)}... (${s.length} chars)` : input;
}

// ---------------------------------------------------------------------------
// Pages (server components)
// ---------------------------------------------------------------------------

/** Run a server component body inside a request context so its logs carry the request id. */
export async function withPage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const existing = currentRequest();
  if (existing) return fn();
  const reqId = await resolveReqId(`page.${name}`);
  const store = newStore(reqId, "PAGE", name);
  return requestStorage.run(store, async () => {
    flushNote(reqId);
    const plog = createLogger(`page.${name}`);
    plog.debug("render start");
    try {
      const out = await fn();
      plog.debug(`render done in ${Math.round(performance.now() - store.startedAt)}ms`);
      return out;
    } catch (err) {
      // Next uses throws for redirect() and notFound(); log them as control flow, not errors.
      const digest = (err as { digest?: string })?.digest ?? "";
      if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) {
        plog.info("render ended by navigation control flow", { digest: digest.split(";")[0] });
      } else {
        plog.error("render failed", { err });
      }
      throw err;
    }
  });
}
