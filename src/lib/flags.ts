import "server-only";
// Feature flags for the sponsor integrations. Each one is an env var, off unless set to 1 / true /
// on, and the app works the same as before with every one of them off. Every check is logged
// ("flag stepfun_vision=off (FEATURE_STEPFUN_VISION unset) for the composer"), so grep "flag " says
// which integrations a request saw.
//
//   fetch_agent      FEATURE_FETCH_AGENT       /api/agent/* routes the ASI:One uAgent calls (agents/fetch/)
//   creao_glossary   FEATURE_CREAO_GLOSSARY    company jargon resolved by a CREAO agent before retrieval
//   photon           FEATURE_PHOTON            drafts texted to the account's own phone, SENT replies
//   stepfun_vision   FEATURE_STEPFUN_VISION    screenshots read by step-5-preview in the understanding step
//
// A flag that is on but missing its credentials still counts as on: the calls go through and fail
// the way a missing key always fails (model calls fall back to the demo result, Photon reports
// PHOTON_NOT_CONFIGURED). flagStatus() lists what is missing for /admin/models and pnpm preflight.

import { createLogger } from "./log";

const log = createLogger("flags");

export const FLAG_ENV = {
  fetch_agent: "FEATURE_FETCH_AGENT",
  creao_glossary: "FEATURE_CREAO_GLOSSARY",
  photon: "FEATURE_PHOTON",
  stepfun_vision: "FEATURE_STEPFUN_VISION",
} as const;

export type FlagName = keyof typeof FLAG_ENV;

/** The env vars each integration needs besides its flag. */
export const FLAG_REQUIRES: Record<FlagName, string[]> = {
  fetch_agent: ["AGENT_API_TOKEN"],
  creao_glossary: ["CREAO_API_KEY", "CREAO_APP_ID"],
  photon: ["PHOTON_API_KEY", "PHOTON_PROJECT_ID", "PHOTON_AGENT_HANDLE"],
  stepfun_vision: ["STEPFUN_API_KEY"],
};

export const FLAG_LABEL: Record<FlagName, string> = {
  fetch_agent: "Fetch.ai ASI:One agent API",
  creao_glossary: "CREAO glossary agent",
  photon: "Photon draft delivery",
  stepfun_vision: "StepFun screenshot reading",
};

function readOn(name: FlagName): { on: boolean; raw: string | undefined } {
  const raw = process.env[FLAG_ENV[name]];
  return { on: !!raw && ["1", "true", "on", "yes"].includes(raw.trim().toLowerCase()), raw };
}

/** Is this integration on? Logs one line per check, with what asked. */
export function flagOn(name: FlagName, forWhat: string): boolean {
  const { on, raw } = readOn(name);
  const missing = on ? FLAG_REQUIRES[name].filter((k) => !process.env[k]) : [];
  log.debug(`flag ${name}=${on ? "on" : "off"} (${FLAG_ENV[name]}=${raw ?? "unset"}) for ${forWhat}${missing.length ? `; WARNING missing ${missing.join(", ")}` : ""}`);
  return on;
}

export type FlagStatus = { name: FlagName; label: string; env: string; on: boolean; missing: string[] };

/** Every flag with its missing env vars (names only, never values). No log line per flag. */
export function flagStatus(): FlagStatus[] {
  return (Object.keys(FLAG_ENV) as FlagName[]).map((name) => ({
    name,
    label: FLAG_LABEL[name],
    env: FLAG_ENV[name],
    on: readOn(name).on,
    missing: FLAG_REQUIRES[name].filter((k) => !process.env[k]),
  }));
}
