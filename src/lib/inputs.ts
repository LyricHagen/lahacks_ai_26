// Zod schemas for every server action input and API route parameter. withAction(name, fn, schema)
// and parseParams/parseQuery (src/lib/request-context.ts) run them before any handler code, so a
// handler only ever sees the shape it declares. A failure is BAD_REQUEST (400), logged with the
// failing field paths and never their values.
//
// These are structural: types, id formats, enums, and generous size caps. The handlers keep their
// own semantic checks (minimum ask length, draft word limits, allowed transitions), which return
// the more specific codes (ASK_TOO_SHORT, DRAFT_INVALID, ...). Add a schema here with every new action.

import { z } from "zod";
import { DRAFT_FORMATS, DRAFT_VARIANTS } from "./draft";
import type { OnboardingStep } from "./onboarding";

export const AskId = z.string().regex(/^ask_\d{1,9}$/);
export const EmployeeId = z.string().regex(/^emp_\d{1,6}$/);
export const UserId = z.string().regex(/^usr_\d{1,9}$/);
const RefId = z.string().regex(/^[a-z]{2,4}_[a-z0-9_]{1,60}$/);
const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Same-site path only, for ?next= redirects. */
const NextPath = z.string().max(300).regex(/^\/(?!\/)/);
const Text = (max: number) => z.string().max(max);
// Type-only import above: onboarding.ts reaches the database, and this module must stay import-light.
const ONBOARDING_STEPS = ["role", "context", "channels"] as const satisfies readonly OnboardingStep[];

export const ActionInputs = {
  "ask.create": z.object({
    body: Text(8000),
    tried: Text(4000).optional(),
    urgency: z.string().max(40).optional(),
    confidential: Text(4000).optional(),
    // About 1.5 MB decoded; asks.ts checks the type, the magic bytes and the exact size.
    screenshot: z.object({ mime: z.string().max(40), dataBase64: z.string().max(2_100_000).regex(/^[A-Za-z0-9+/=]*$/) }).optional(),
  }),
  "ask.abandon": z.object({ askId: AskId }),
  "ask.retry": z.object({ askId: AskId }),
  "ask.reshortlist": z.object({ askId: AskId }),
  "ask.choose": z.object({ askId: AskId, employeeId: EmployeeId, tune: z.number().min(-1).max(1).optional(), shownRank: z.number().int().min(1).max(50).optional() }),
  "ask.draft.save": z.object({ askId: AskId, variant: z.enum(DRAFT_VARIANTS), format: z.enum(DRAFT_FORMATS), subject: Text(1000), body: Text(20000) }),
  "ask.draft.copy": z.object({ askId: AskId, variant: z.enum(DRAFT_VARIANTS), format: z.enum(DRAFT_FORMATS), subject: Text(1000), body: Text(20000) }),
  "ask.sent": z.object({ askId: AskId, variant: z.enum(DRAFT_VARIANTS), format: z.enum(DRAFT_FORMATS), subject: Text(1000), body: Text(20000) }),
  "ask.answered": z.object({ askId: AskId, note: Text(2000).optional() }),
  "ask.next": z.object({ askId: AskId, employeeId: EmployeeId }),
  "auth.login": z.object({ email: Text(320), password: Text(200), next: NextPath.nullish() }),
  "auth.signup": z.object({ email: Text(320), password: Text(200) }),
  "admin.users.approve": z.object({ userId: UserId }),
  "admin.users.reject": z.object({ userId: UserId }),
  "admin.reseed": z.object({ seed: Text(80) }),
  "mode.toggle": z.object({ demo: z.boolean() }),
  "onboarding.persona": z.object({ employeeId: EmployeeId }),
  "onboarding.context": z.object({ knownSkillIds: z.array(z.string().regex(/^skl_[a-z0-9_]{1,40}$/)).max(60), firstFocus: Text(400) }),
  "onboarding.channels": z.object({ preferredChannel: z.enum(["slack", "email", "call"]), okToInterruptSeniors: z.boolean() }),
  "onboarding.skip": z.object({ step: z.enum([...ONBOARDING_STEPS, "rest"]) }),
  "insights.opt_in": z.object({ on: z.boolean() }),
  "ramp.dismiss": z.object({ weekStart: IsoDay, refId: RefId }),
  "ramp.undo": z.object({ refId: RefId }),
  "demo.enter": z.object({ next: NextPath.nullish() }).optional(),
  "phone.link": z.object({ handle: Text(200) }),
  "phone.unlink": z.undefined(),
  "phone.deliver": z.object({ askId: AskId, variant: z.enum(DRAFT_VARIANTS), format: z.enum(DRAFT_FORMATS), subject: Text(1000), body: Text(20000) }),
  // Self-validating (their own Zod schema in the handler) or taking no input:
  "ask.confirm": z.unknown(),
  "auth.delete_account": z.unknown(),
  "auth.logout": z.undefined(),
  "admin.gate_check": z.undefined(),
  "onboarding.role": z.undefined(),
  "demo.reset": z.undefined(),
} satisfies Record<string, z.ZodType>;

export type ActionName = keyof typeof ActionInputs;

/** JSON bodies of the agent API (/api/agent/*, FEATURE_FETCH_AGENT). */
export const AgentBodies = {
  create: z.object({ body: Text(4000), tried: Text(2000).optional(), urgency: z.enum(["blocked_now", "blocked_today", "curious"]).optional() }),
  confirm: z.object({ answeredByDocId: z.string().regex(/^doc_[a-z0-9_]{1,80}$/).nullable().optional() }),
  choose: z.object({ employeeId: EmployeeId }),
  sent: z.object({ variant: z.enum(DRAFT_VARIANTS) }),
};

export const ParamSchemas = {
  askId: z.object({ askId: AskId }),
};

export const QuerySchemas = {
  "debug.logs": z.object({ reqId: z.string().regex(/^req_[a-z0-9]{1,20}$/).optional() }),
  "debug.fail": z.object({ code: z.string().regex(/^[A-Z_]{2,40}$/).optional() }),
  "debug.ping": z.object({ path: z.string().max(2000).optional() }),
};
