// Sentry on the server (Node runtime only; the app has no edge routes). Tracing is on, so the
// spans from src/lib/observe.ts (model calls, retrieval, ranking) hang under each request.
// Without SENTRY_DSN nothing initializes and the app runs exactly as before.

import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/observe";

export async function register() {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn || process.env.NEXT_RUNTIME !== "nodejs") return;
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 1),
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event),
  });
}

export const onRequestError = Sentry.captureRequestError;
