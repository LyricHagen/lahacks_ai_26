import "server-only";
// Photon 2.0 (beta) API client: list the messages people texted the agent's number, and reply in
// the same conversation. Only src/lib/phone.ts uses it, and phone.ts only ever replies in a space
// opened by an account's own, verified number (the rule: never message anyone else).
//
//   PHOTON_API_KEY        project API key (pho_sk_...), scopes project:read and project:write
//   PHOTON_PROJECT_ID     pho_prj_...
//   PHOTON_AGENT_HANDLE   the number (or iMessage address) Photon assigned to the agent, shown on /account
//   PHOTON_API_URL        default https://api.photon.codes/v1
//
// Endpoints (OpenAPI at https://api.photon.codes/openapi.json):
//   GET  /projects/{id}/messages?createdSince&direction=received&order=asc&pageSize&pageToken
//   POST /projects/{id}/messages  {spaceId, senderId, parentMessageId, content:{type:text,format:plain,text}}
//        with an Idempotency-Key header, so a retried send never texts twice.
// Every request is logged with method, path, status, ms and Photon's request id; message text never is.

import { AppError } from "./errors";
import { createLogger } from "./log";

const log = createLogger("photon.api");

const DEFAULT_URL = "https://api.photon.codes/v1";
const TIMEOUT_MS = 15_000;

export function photonConfigured(): { ok: true } | { ok: false; missing: string[] } {
  const missing = ["PHOTON_API_KEY", "PHOTON_PROJECT_ID", "PHOTON_AGENT_HANDLE"].filter((k) => !process.env[k]);
  return missing.length ? { ok: false, missing } : { ok: true };
}

export function agentHandle(): string | null {
  return process.env.PHOTON_AGENT_HANDLE || null;
}

/** A received message, reduced to what the app reads. */
export type InboundMessage = {
  id: string;
  createdAt: string;
  platform: string;
  /** The person who texted (E.164 phone or iMessage email). */
  fromHandle: string;
  fromKind: string;
  /** The agent's own user id on this platform: the senderId of a reply. */
  agentUserId: string;
  spaceId: string;
  spaceKind: string;
  /** Plain text, or null for an attachment, reaction or anything else. */
  text: string | null;
};

type RawMessage = {
  id: string;
  createdAt: string;
  platform: string;
  status?: string;
  sentBy?: { handle?: string; kind?: string; id?: string };
  receivedBy?: { handle?: string; kind?: string; id?: string } | null;
  space?: { id?: string; kind?: string };
  content?: { type?: string; format?: string; text?: string; parts?: Array<{ type?: string; format?: string; text?: string }> };
};

async function request(method: "GET" | "POST", path: string, opts: { body?: unknown; idempotencyKey?: string; label: string }): Promise<unknown> {
  const url = `${process.env.PHOTON_API_URL || DEFAULT_URL}/projects/${process.env.PHOTON_PROJECT_ID}${path}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = performance.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${process.env.PHOTON_API_KEY}`,
          accept: "application/json",
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      log.warn(`${opts.label}: ${method} ${path.split("?")[0]} attempt ${attempt}/2 network error after ${ms}ms: ${(err as Error).message}`, { err });
      if (attempt === 1) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      throw new AppError("PHOTON_SEND_FAILED", `photon unreachable: ${(err as Error).message}`, { status: 502, cause: err });
    }
    const ms = Math.round(performance.now() - t0);
    const photonReq = res.headers.get("x-request-id") ?? res.headers.get("request-id") ?? "none";
    const text = await res.text();
    if (res.ok) {
      log.info(`${opts.label}: ${method} ${path.split("?")[0]} answered ${res.status} in ${ms}ms (photon request ${photonReq}, attempt ${attempt})`);
      return text ? JSON.parse(text) : {};
    }
    // Problem+JSON: {type, title, status, detail}. Logged as given; it never contains message text we sent.
    const retryable = res.status === 429 || res.status >= 500;
    log.warn(`${opts.label}: ${method} ${path.split("?")[0]} answered ${res.status} in ${ms}ms (photon request ${photonReq}, attempt ${attempt}/2${retryable && attempt === 1 ? ", retrying" : ""}): ${text.slice(0, 300)}`);
    if (retryable && attempt === 1) {
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }
    throw new AppError("PHOTON_SEND_FAILED", `photon answered ${res.status}: ${text.slice(0, 160)}`, { status: 502, context: { status: res.status, photonReq } });
  }
  throw new AppError("PHOTON_SEND_FAILED", "photon: no attempt left", { status: 502 });
}

function textOf(m: RawMessage): string | null {
  const c = m.content;
  if (!c) return null;
  if (c.type === "text" && typeof c.text === "string") return c.text;
  if (c.type === "group") return c.parts?.find((p) => p.type === "text" && p.format === "plain")?.text ?? null;
  return null;
}

/** Messages people texted the agent since an instant, oldest first, all pages. */
export async function listReceived(createdSince: string): Promise<InboundMessage[]> {
  const out: InboundMessage[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const qs = new URLSearchParams({ createdSince, direction: "received", order: "asc", pageSize: "100", ...(pageToken ? { pageToken } : {}) });
    const page = (await request("GET", `/messages?${qs}`, { label: "list received" })) as { items?: RawMessage[]; nextPageToken?: string };
    pages++;
    for (const m of page.items ?? []) {
      if (m.status && m.status !== "received") continue;
      out.push({
        id: m.id,
        createdAt: m.createdAt,
        platform: m.platform,
        fromHandle: m.sentBy?.handle ?? "",
        fromKind: m.sentBy?.kind ?? "",
        agentUserId: m.receivedBy?.id ?? "",
        spaceId: m.space?.id ?? "",
        spaceKind: m.space?.kind ?? "",
        text: textOf(m),
      });
    }
    pageToken = page.nextPageToken;
  } while (pageToken && pages < 10);
  log.info(`list received since ${createdSince}: ${out.length} message(s) in ${pages} page(s)`);
  return out;
}

/** Reply in a conversation. idempotencyKey makes a retry of the same reply a no-op. Returns Photon's message id. */
export async function sendText(args: { spaceId: string; senderId: string; parentMessageId?: string; text: string; idempotencyKey: string; label: string }): Promise<string | null> {
  const r = (await request("POST", "/messages", {
    label: args.label,
    idempotencyKey: args.idempotencyKey,
    body: { spaceId: args.spaceId, senderId: args.senderId, ...(args.parentMessageId ? { parentMessageId: args.parentMessageId } : {}), content: { type: "text", format: "plain", text: args.text } },
  })) as { id?: string };
  log.info(`${args.label}: sent ${args.text.length} chars to space ${args.spaceId} as ${args.senderId} (message ${r.id ?? "id not returned"}, idempotency ${args.idempotencyKey})`);
  return r.id ?? null;
}
