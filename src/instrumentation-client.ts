// Sentry in the browser: errors, tracing of navigations, and session replay. Replay masks every
// text node and input and blocks media, so a recording never shows an ask, a draft or a
// confidential note, only the layout and clicks. Without NEXT_PUBLIC_SENTRY_DSN nothing loads.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 1,
    sendDefaultPii: false,
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
      }),
    ],
    replaysSessionSampleRate: 1,
    replaysOnErrorSampleRate: 1,
  });
}

export const onRouterTransitionStart = dsn
  ? Sentry.captureRouterTransitionStart
  : undefined;
