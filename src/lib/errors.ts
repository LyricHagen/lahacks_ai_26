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
  RANK_TIMEOUT: "Ranking took too long.",
  MODEL_CALL_FAILED: "The model call failed.",
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
  MODEL_FIXTURE_MISSING: "No live result was allowed and no cached demo result exists for this input.",
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
