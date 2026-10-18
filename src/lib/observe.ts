// Sentry spans and error reports for server code. Uses @sentry/core (the same client that
// @sentry/nextjs registers in src/instrumentation.ts), so it is safe in scripts too: without a DSN
// there is no client and every call here just runs the callback.
//
//   span("model.understand_ask", "ai.model", { purpose }, () => ...)   tracing around model calls, retrieval, ranking
//   reportError(err, { reqId, where, code })                            unexpected (5xx) failures from withRoute/withAction
//
// Nothing user-typed goes in a span attribute: ids, counts, purposes and tier names only.

import * as Sentry from "@sentry/core";
import { redactString } from "./log-format";

type Attr = string | number | boolean | undefined;

export function sentryEnabled(): boolean {
  return !!Sentry.getClient();
}

export function span<T>(name: string, op: string, attributes: Record<string, Attr>, fn: () => Promise<T>): Promise<T> {
  if (!Sentry.getClient()) return fn();
  const attrs = Object.fromEntries(Object.entries(attributes).filter(([, v]) => v !== undefined)) as Record<string, string | number | boolean>;
  return Sentry.startSpan({ name, op, attributes: attrs }, fn);
}

/** Tag the active span (for example the tier that served a model call). */
export function spanAttr(key: string, value: Attr): void {
  if (value === undefined || !Sentry.getClient()) return;
  Sentry.getActiveSpan()?.setAttribute(key, value);
}

export function reportError(err: unknown, ctx: { reqId: string; where: string; code: string }): void {
  if (!Sentry.getClient()) return;
  Sentry.withScope((scope) => {
    scope.setTag("req_id", ctx.reqId);
    scope.setTag("error_code", ctx.code);
    scope.setTag("where", ctx.where);
    Sentry.captureException(err);
  });
}

type Scrubbable = { request?: { data?: unknown; cookies?: unknown; headers?: Record<string, string> }; message?: string; exception?: { values?: Array<{ value?: string }> } };

/** beforeSend for every runtime: drop request bodies and cookies, run messages through log redaction. */
export function scrubEvent<E extends Scrubbable>(event: E): E {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers.cookie;
      delete event.request.headers.authorization;
    }
  }
  if (event.message) event.message = redactString(event.message);
  for (const v of event.exception?.values ?? []) if (v.value) v.value = redactString(v.value);
  return event;
}
