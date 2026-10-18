// Shared by the server logger (src/lib/log.ts) and the client logger (src/lib/client-log.ts).
// Pure functions only: no Node or browser APIs, so both bundles can import it.

export const LEVELS = ["trace", "debug", "info", "warn", "error"] as const;
export type Level = (typeof LEVELS)[number];

export type LogContext = Record<string, unknown>;

export function levelRank(level: Level): number {
  return LEVELS.indexOf(level);
}

export function parseLevel(value: string | undefined, fallback: Level): Level {
  const v = (value ?? "").toLowerCase();
  return (LEVELS as readonly string[]).includes(v) ? (v as Level) : fallback;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

export function formatTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

// ---------------------------------------------------------------------------
// Redaction. Runs on the final line, so nothing can slip past via a nested object.
// ---------------------------------------------------------------------------

const SECRET_KEY_NAMES =
  /^(password|passwd|pass|secret|token|apikey|api_key|apiKey|authorization|auth|cookie|set-cookie|session|sessionToken|accessToken|refreshToken|privateKey|private_key|client_secret|clientSecret|confidential|sensitive)$/i;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Anthropic, OpenAI and similar "sk-" keys
  [/\bsk-[A-Za-z0-9_-]{12,}/g, "sk-[REDACTED]"],
  // Bearer / Basic auth headers
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [REDACTED]"],
  // Credentials inside connection strings: scheme://user:password@host
  [/([a-z][a-z0-9+.-]*:\/\/[^:/\s"@]+):[^@\s"/]+@/gi, "$1:[REDACTED]@"],
  // Same, URL-encoded (shows up in logged query strings): scheme%3A%2F%2Fuser%3Apassword%40host
  [/(%3A%2F%2F[^%\s"]+%3A)[^\s"]+?(%40)/gi, "$1[REDACTED]$2"],
  // JWTs
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[REDACTED_JWT]"],
  // Common vendor prefixes (GitHub, Slack, Google, AWS)
  [/\b(ghp|gho|ghs|github_pat|xox[abpr])_?[A-Za-z0-9_-]{16,}/g, "[REDACTED_TOKEN]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "[REDACTED_TOKEN]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_TOKEN]"],
];

/** Replace values of secret-looking keys before JSON encoding. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth limit]";
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_NAMES.test(k) && v != null && v !== "" ? "[REDACTED]" : redactValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Pattern pass over a finished string, plus any exact secret values the caller knows about. */
export function redactString(s: string, knownSecrets: readonly string[] = []): string {
  let out = s;
  for (const secret of knownSecrets) {
    // Env secrets are already 8+ characters (log.ts); per-request sensitive values may be shorter.
    if (secret.length >= 3) out = out.split(secret).join("[REDACTED_VALUE]");
  }
  for (const [re, replacement] of SECRET_PATTERNS) out = out.replace(re, replacement);
  return out;
}

// ---------------------------------------------------------------------------
// Errors become plain objects so the stack survives JSON encoding (as escaped \n, still one line).
// ---------------------------------------------------------------------------

// Errors already written once: later lines (a wrapper's cause chain) reference them instead of
// repeating the whole stack.
const alreadyLogged = new WeakSet<object>();

/**
 * Keep every frame from our code, the first 3 framework frames, and count the rest.
 * Framework frames (node_modules, node:internal) are rarely useful and can be 30+ lines.
 */
export function compactStack(stack: string | undefined): string | undefined {
  if (!stack) return stack;
  const lines = stack.split("\n");
  const out: string[] = [];
  let framework = 0;
  let omitted = 0;
  for (const l of lines) {
    const isFrame = /^\s+at /.test(l);
    const isFramework = isFrame && /(node_modules|node:internal|\(native\)|next-server|webpack-internal)/.test(l);
    if (isFramework) {
      framework++;
      if (framework > 3) {
        omitted++;
        continue;
      }
    }
    out.push(l);
  }
  if (omitted) out.push(`    (+${omitted} framework frames omitted)`);
  return out.join("\n");
}

export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    if (alreadyLogged.has(err)) {
      const e = err as Error & { code?: unknown };
      return { name: e.name, message: e.message, ...(e.code !== undefined ? { code: e.code } : {}), stack: "(full stack logged on an earlier line)" };
    }
    alreadyLogged.add(err);
    const e = err as Error & { code?: unknown; cause?: unknown; context?: unknown; status?: unknown };
    return {
      name: e.name,
      message: e.message,
      ...(e.code !== undefined ? { code: e.code } : {}),
      ...(e.status !== undefined ? { status: e.status } : {}),
      ...(e.context !== undefined ? { context: e.context } : {}),
      stack: compactStack(e.stack),
      ...(e.cause !== undefined ? { cause: serializeError(e.cause) } : {}),
    };
  }
  return { nonError: true, value: String(err) };
}

function safeJson(ctx: LogContext): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(redactValue(ctx), (_k, v) => {
      if (v instanceof Error) return serializeError(v);
      if (typeof v === "bigint") return v.toString();
      if (v && typeof v === "object") {
        if (seen.has(v)) return "[circular]";
        seen.add(v);
      }
      return v;
    });
  } catch (e) {
    return JSON.stringify({ unserializable: String(e) });
  }
}

export type LineParts = {
  time: Date;
  reqId: string;
  scope: string;
  level: Level;
  msg: string;
  ctx?: LogContext;
};

/**
 * [14:02:11.443] [req_8f3a1c] [ask.rank] INFO scored 24 candidates in 81ms {"askId":"ask_12"}
 * Always exactly one line: newlines in the message are escaped.
 */
export function formatLine(p: LineParts, knownSecrets: readonly string[] = []): string {
  const msg = p.msg.replace(/\r?\n/g, "\\n");
  const cleaned = p.ctx ? Object.fromEntries(Object.entries(p.ctx).filter(([, v]) => v !== undefined)) : undefined;
  const ctx = cleaned && Object.keys(cleaned).length > 0 ? " " + safeJson(cleaned) : "";
  const line = `[${formatTime(p.time)}] [${p.reqId}] [${p.scope}] ${p.level.toUpperCase()} ${msg}${ctx}`;
  return redactString(line, knownSecrets);
}

export function shortId(prefix: string, bytes = 3): string {
  let hex = "";
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.getRandomValues) {
    const buf = new Uint8Array(bytes);
    cryptoObj.getRandomValues(buf);
    hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  } else {
    for (let i = 0; i < bytes * 2; i++) hex += Math.floor(Math.random() * 16).toString(16);
  }
  return `${prefix}_${hex}`;
}
