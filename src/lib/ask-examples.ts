import "server-only";
// Example asks for the composer, so the demo never starts from a blank page. Each one names real
// services from the seeded company; an example whose services are missing (a different seed) is
// left out and logged, rather than showing a question about something that does not exist.

import { inArray } from "drizzle-orm";
import { q } from "@/db";
import * as t from "@/db/schema";
import type { AskUrgency } from "./ask-state";
import { createLogger } from "./log";

const log = createLogger("ask.examples");

export type AskExample = { id: string; label: string; body: string; tried: string; urgency: AskUrgency };

type ExampleDef = AskExample & { serviceIds: string[] };

const EXAMPLES: ExampleDef[] = [
  {
    id: "deploy",
    label: "Failing deploy",
    body: "My deploy of invoice-worker to staging fails at the Helm upgrade step with \"context deadline exceeded\". The new pods never become ready and the release rolls back. Who can help me figure out why?",
    tried: "Re-ran the build-pipeline job twice and checked that the image tag exists.",
    urgency: "blocked_now",
    serviceIds: ["svc_invoicing", "svc_k8s", "svc_build"],
  },
  {
    id: "stripe",
    label: "Double charge",
    body: "A staging shipper got charged twice when a Stripe webhook retried. Where does billing-service check for duplicate events, and who knows that code?",
    tried: "Found the webhook handler but could not see where the event id is stored.",
    urgency: "blocked_today",
    serviceIds: ["svc_billing"],
  },
  {
    id: "kafka",
    label: "Consumer lag",
    body: "Consumer lag on the shipment events topic keeps growing in ingest-pipeline since this morning. Is this expected after the Airflow backfill, or should someone look at it?",
    tried: "",
    urgency: "blocked_today",
    serviceIds: ["svc_ingest"],
  },
  {
    id: "sso",
    label: "SSO login loop",
    body: "One enterprise shipper's SAML login loops back to the sign-in page on auth-gateway. Who owns SSO, and is there a way to see the assertion we receive?",
    tried: "Reproduced it with their test account. Other SSO customers are fine.",
    urgency: "blocked_today",
    serviceIds: ["svc_auth"],
  },
  {
    id: "ios",
    label: "iOS build",
    body: "The iOS release build in mobile-ci fails at the archive step since the runners moved to the new Xcode. Who should I ask?",
    tried: "",
    urgency: "blocked_now",
    serviceIds: ["svc_mobile_build"],
  },
  {
    id: "flags",
    label: "Feature flags",
    body: "How do people usually add a feature flag in flagd for a change in the web app? I want to understand the convention before my first rollout.",
    tried: "",
    urgency: "curious",
    serviceIds: ["svc_flags", "svc_web_app"],
  },
];

export async function getAskExamples(): Promise<AskExample[]> {
  const ids = [...new Set(EXAMPLES.flatMap((e) => e.serviceIds))];
  const rows = await q("ask.examples.services", (db) => db.select({ id: t.services.id }).from(t.services).where(inArray(t.services.id, ids)));
  const have = new Set(rows.map((r) => r.id));
  const out: AskExample[] = [];
  for (const { serviceIds, ...e } of EXAMPLES) {
    const missing = serviceIds.filter((id) => !have.has(id));
    if (missing.length) {
      log.skip(`example "${e.id}"`, `services ${missing.join(", ")} are not in the loaded company`);
      continue;
    }
    out.push(e);
  }
  log.debug(`${out.length} of ${EXAMPLES.length} example asks available`);
  return out;
}
