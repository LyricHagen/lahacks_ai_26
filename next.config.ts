import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The floating dev badge overlaps the debug drawer; build errors still show in the overlay.
  devIndicators: false,
  serverExternalPackages: ["postgres"],
  // Next prints every server function call with its raw arguments in dev, which would put
  // passwords and confidential ask notes in the terminal. withAction logs inputs with redaction.
  logging: { serverFunctions: false },
  // The reseed button reads the committed fixture at runtime; make sure it ships with the server.
  // /admin/models reads the committed eval results the same way.
  outputFileTracingIncludes: { "/admin/**": ["./fixtures/company.json", "./data/understand/eval/results.json"] },
};

// Source maps upload only when SENTRY_AUTH_TOKEN (plus SENTRY_ORG, SENTRY_PROJECT) is set; the
// build passes without any of them.
export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
