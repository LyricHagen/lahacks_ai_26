import "server-only";
// Every kind of model call the app makes, by name. callModel({ purpose }) looks the spec up here.
// To add one: write a PurposeSpec, add its model to MODEL_PRICES (src/lib/model-log.ts), and
// commit its demo fixture under fixtures/demo/ so demo mode looks identical to live mode.

import gateCheckFixture from "../../fixtures/demo/gate_check.json";
import type { PurposeSpec } from "./model";

const CHEAP_MODEL = "claude-haiku-5-5";

/** One sentence round trip, used by the "Run a gate check" button on /admin/usage. */
const gateCheck: PurposeSpec<Record<string, never>, { reply: string }> = {
  request: () => ({
    model: CHEAP_MODEL,
    system: "You are a health check. Reply with one short plain sentence saying you are reachable. Do not use em dashes or en dashes.",
    prompt: "Are you reachable?",
    maxTokens: 200,
    effort: "low",
    timeoutMs: 30_000,
  }),
  parse: (text) => {
    const reply = text.trim();
    if (!reply) throw new Error("empty reply");
    return { reply };
  },
  fixture: () => gateCheckFixture.output,
};

export type FixtureTextInput = { batch: string; system: string; instructions: string; items: Array<{ id: string; facts: string }> };

/** Rewrites seed text once for fixtures/company.json (scripts/generate-fixture.ts). No demo fixture: templates stay. */
const fixtureText: PurposeSpec<FixtureTextInput, Array<{ id: string; text: string }>> = {
  describe: (i) => i.batch,
  request: (i) => ({
    model: CHEAP_MODEL,
    system: i.system,
    prompt: `${i.instructions}\n\nItems:\n${JSON.stringify(i.items)}`,
    maxTokens: 16_000,
    effort: "low",
    timeoutMs: 10 * 60_000,
    jsonSchema: {
      type: "array",
      items: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"], additionalProperties: false },
    },
  }),
  parse: (text) => {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("model output is not a JSON array");
    return parsed.flatMap((row) => {
      const r = row as { id?: unknown; text?: unknown };
      return typeof r.id === "string" && typeof r.text === "string" ? [{ id: r.id, text: r.text }] : [];
    });
  },
  fixture: () => null,
};

export const PURPOSES = {
  gate_check: gateCheck,
  fixture_text: fixtureText,
};

export type PurposeName = keyof typeof PURPOSES;
