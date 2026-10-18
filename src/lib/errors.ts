// Every failure the user can see carries one of these codes, and the same code is in the log.
// Add new codes here (SCREAMING_SNAKE, area first) rather than inventing strings inline.

export const ERROR_CODES = {
  UNKNOWN: "Something went wrong.",
  BAD_REQUEST: "The request was not valid.",
  NOT_FOUND: "That page or record does not exist.",
  FORBIDDEN: "You do not have access to this.",
  NETWORK: "The server could not be reached.",
  BAD_RESPONSE: "The server sent a response we could not read.",
  DB_NOT_CONFIGURED: "DATABASE_URL is not set.",
  DB_UNAVAILABLE: "The database did not respond.",
  DB_QUERY_FAILED: "A database query failed.",
  DEBUG_FORBIDDEN: "Server logs are only visible in development or to admins.",
  CLIENT_RENDER: "This page failed to render.",
  SERVER_RENDER: "The server failed to build this page.",
  RANK_TIMEOUT: "Ranking took too long.",
  RANK_EXCLUDED: "That person is excluded from the shortlist by a fairness rule (weekly ask limit or out of office).",
  MODEL_CALL_FAILED: "The model call failed.",
  MODEL_TIER_TIMEOUT: "The fast model did not answer in time, so a slower one answered instead.",
  MODEL_TIER_FAILED: "The fast model failed, so a slower one answered instead.",
  SEED_INVALID: "The generated company failed its structural checks.",
  SEED_FAILED: "Reseeding the database failed.",
  SEED_EMPTY: "The database has no synthetic company yet. Run pnpm db:reset or reseed from /admin/seed.",
  ADMIN_ONLY: "Only admins can do this.",
  AUTH_REQUIRED: "Sign in to see this page.",
  AUTH_INVALID_CREDENTIALS: "That email and password do not match an account.",
  AUTH_EMAIL_TAKEN: "An account with that email already exists. Log in instead.",
  AUTH_INVALID_INPUT: "Check the email and password and try again.",
  AUTH_NOT_CONFIGURED: "AUTH_SECRET is not set, so sessions cannot be signed.",
  RATE_LIMITED: "Too many attempts from this network. Wait a few minutes and try again.",
  USER_NOT_FOUND: "That account does not exist.",
  ASK_NOT_FOUND: "That ask does not exist, or it belongs to someone else.",
  ASK_INVALID_INPUT: "Describe what you are stuck on (at least a few words).",
  ASK_ILLEGAL_TRANSITION: "That step is not allowed from the ask's current state.",
  ASK_STATE_CONFLICT: "The ask changed in another tab or request. Reload to see its current state.",
  ASK_CONFIRM_INVALID: "Something in the corrected chips was not valid. Check them and try again.",
  ASK_STEP_FAILED: "A processing step failed. The ask went back to draft so you can try again.",
  PERSONA_UNAVAILABLE: "That colleague is already played by another account, or cannot be chosen.",
  ONBOARDING_INVALID: "Check the answers on this step and try again.",
  MODEL_FIXTURE_MISSING: "No live result was allowed and no cached demo result exists for this input.",
  AVAILABILITY_FAILED: "Free and busy times could not be loaded.",
  CLIENT_CLIPBOARD: "The browser did not allow copying to the clipboard.",
  DRAFT_INVALID: "The draft could not be saved. Check the message and try again.",
  RAMP_ITEM_NOT_FOUND: "That item is not in your ramp plan (it may have been rebuilt). Reload the page.",
  RAMP_FAILED: "The ramp plan could not be built.",
  DEMO_NOT_READY: "The guided demo needs the seeded company with its demo persona. Reseed from /admin/seed or run pnpm db:reset.",
  DEMO_RESET_FAILED: "Resetting the demo failed. Nothing you see may be complete; try Reset demo again.",
  DEMO_RESET_BUSY: "The demo is being reset right now. Wait a few seconds and reload.",
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  code: ErrorCode;
  status: number;
  context?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, opts: { status?: number; cause?: unknown; context?: Record<string, unknown> } = {}) {
    super(message ?? ERROR_CODES[code], opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = opts.status ?? 500;
    this.context = opts.context;
  }
}

export function isErrorCode(v: unknown): v is ErrorCode {
  return typeof v === "string" && v in ERROR_CODES;
}

/** Normalise anything thrown into an AppError, keeping the original as `cause`. */
export function toAppError(err: unknown, fallback: ErrorCode = "UNKNOWN"): AppError {
  if (err instanceof AppError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new AppError(fallback, message, { cause: err });
}
