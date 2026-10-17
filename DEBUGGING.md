# Debugging Who2Ask

The owner debugs this app by copying log output and pasting it into a fresh session. **Assume nobody can see the screen, only the log.** Logging is a first-class feature: code without logs is incomplete.

## Getting the log

| Where | How |
|---|---|
| Any page | Press **Ctrl+`** or click **log** in the footer. The drawer shows client lines and server lines (from API responses), newest last. **Copy all** / **Copy last 50** produce plain text ready to paste. Copy respects the filter box. |
| `/debug` | Full-page version for this browser tab's session (persisted in sessionStorage), with **Download**. |
| `/debug?view=server` | The server's in-memory ring buffer: last 500 lines across all requests. Development or admins only. |
| Terminal | `pnpm dev` prints every server line. |
| One request | Filter by its id: `req_8f3a1c`. The id is in the `X-Request-Id` response header, in every JSON body as `reqId`, and in every `ErrorState`. |

Copied text starts with a header line (`# Who2Ask log, drawer, last 50, ..., page /ask/new, copied ...`) so the pasted log says where it came from.

## Line format

One line per event, always:

```
[14:02:11.443] [req_8f3a1c] [ask.rank] INFO scored 24 candidates in 81ms {"askId":"ask_12","top":"emp_104"}
 time          request id   scope      level message                      JSON context
```

- Request id is `req_` plus 6 hex chars. `client` means a browser line not tied to a request. `req_none` means a server line outside any request context (module load, or a component not wrapped in `withPage`).
- In the drawer each line is prefixed `srv` or `cli` to show where it came from.
- Newlines (stacks) are escaped as `\n`, so a line is always one line.
- Levels: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`. Server minimum level comes from `LOG_LEVEL` (default `trace` in development, `debug` in production).

## Grep cookbook

```
grep req_8f3a1c                follow one request end to end
grep " ERROR "                 every failure, with stacks
grep "branch:"                 every decision and why
grep "skipped:"                every skipped step and why
grep "\[db\]"                  queries with duration and row count
grep "\[db.sql\]"              SQL text (trace level)
grep "\[model\]"               model calls: model, tokens, latency, cost
grep "\[http\]"                every incoming request (from src/proxy.ts)
grep RANK_TIMEOUT              everything about one error code
grep "seed.summary"            what the last seed loaded: counts, timings, planted people, scenarios
grep "TEMPLATED TEXT"          the seed used templates instead of model text, and why
grep "mode="                   every LIVE/DEMO decision with its reason (one line each)
grep "auth decision"           every allow, deny and redirect: proxy, pages, actions, login, signup
grep "gate "                   the five model gate checks for each callModel call
grep "\[auth"                  sessions, logins, signups, persona claims, rate limits, admin decisions
grep "FIRST ACCOUNT"           who became admin automatically, and when
grep RATE_LIMITED              a network address hit the signup or login limit
```

## How the request id works

1. `src/proxy.ts` (Next 16's name for middleware) mints `req_xxxxxx` for every non-static request, logs `[http] INFO GET /path`, forwards it to the app as the `x-request-id` request header and returns it as `X-Request-Id`.
2. `withRoute`, `withAction` and `withPage` (`src/lib/request-context.ts`) read that header and open an `AsyncLocalStorage` context. Every `log.*` call inside, at any depth, gets the id automatically. Nothing is threaded through function arguments.
3. If the header is missing (a path the proxy matcher excludes), the wrapper mints a fresh id and logs a `WARN` saying so.

## Rules for writing code

### Loggers

```ts
// server
import { createLogger } from "@/lib/log";
const log = createLogger("ask.rank");      // scope: area.thing, lowercase, dot separated

// client component
import { createLogger } from "@/lib/client-log";
const log = createLogger("ask.compose");
```

Methods: `trace`, `debug`, `info`, `warn`, `error`, plus:

- `log.branch("use cached shortlist", "ask unchanged since last rank")` at every `if` that picks a path.
- `log.skip("availability check", "person has no calendar in seed")` whenever work is not done.
- `log.timed("embed ask", () => fn(), ctx, (result) => ({ dims: result.length }))` for entry, exit with duration, and failure.
- `log.error("rank failed", { err, askId })`: pass the caught value as `err`. Its name, message, code, context, cause chain and stack are logged. App frames are kept in full; framework frames after the first 3 are counted, not printed. An error that was already logged once is referenced, not repeated.

### What must be logged (be aggressive and verbose)

| Thing | How | Logged automatically |
|---|---|---|
| API route | `export const GET = withRoute("ask.get", async (req, { params }) => ok({...}))` | enter (method, path, query), exit (status, ms, error code) |
| Server action | `export const saveDraft = withAction("draft.save", async (input) => {...})` | enter (input, truncated), exit (ok or code, ms) |
| Server component page | `return withPage("ask.detail", async () => <...>)` | render start, done (ms), failures |
| Database query | `await q("asks.byId", (db) => db.select()...)` | start, done (ms, rows), failure (pg code), SQL at trace |
| Model call | `await trackModelCall("rank", model, async () => ({ result, usage }))` | model, input/output tokens, latency, estimated USD cost |
| Client API call | `await apiFetch("/api/...")` or `await runAction("name", action, input)` | start, status, ms, ingests `_debug`, maps failures to codes |
| Branches and skips | `log.branch`, `log.skip` | (manual, always) |
| Window errors, unhandled rejections, `console.warn/error` | `DebugProvider` | yes, into the drawer |

Add a price for every model to `MODEL_PRICES` in `src/lib/model-log.ts`; a missing price logs a `WARN`.

### Errors

- Never swallow an error. Every `catch` logs `{ err }` with context, then rethrows, returns a failure, or shows an error state.
- Every failure the user can see has a short code from `src/lib/errors.ts` (`RANK_TIMEOUT`, `DB_UNAVAILABLE`, ...). Add new codes there. The same code appears in the log line and in the UI (`ErrorState` shows code and request id; toasts show code).
- Throw `new AppError("RANK_TIMEOUT", message, { status, cause, context })`. `withRoute` turns it into `{ ok: false, error: { code, message } }` with that status. `withAction` returns `{ ok: false, code, message }`.
- `apiFetch` / `runAction` throw `ApiError` with `code` and `reqId`: render them with `ErrorState`.
- Render errors hit `src/app/error.tsx` (code `CLIENT_RENDER`, logged with stack).

### `_debug` in responses

Every JSON response from `withRoute` includes `reqId` and, in development or when the signed-in user is an admin, `_debug`: the lines logged while serving it. `apiFetch` moves them into the drawer (just before its own "response" line) and strips them from the returned body. Server actions wrapped with `withAction` do the same through `runAction`. Admin detection uses `getSessionUser()` in `src/lib/auth.ts` (role read from the database on every request).

## "Why am I in demo mode?"

Open the drawer on any page (or `grep "mode="`). Every page render logs exactly one decision line, and the reason is on that line:

```
[mode] INFO mode=demo reason=pending_user user=usr_2: account is pending approval by an admin, so results come from the demo fixtures
```

| reason | meaning | fix |
|---|---|---|
| `signed_out` | no valid session cookie | log in (`session: signed out` line just above says why) |
| `pending_user` | account not approved yet | an admin approves it on `/admin/users` |
| `rejected_user` | an admin rejected the account | an admin approves it |
| `explicit_demo` | the demo toggle is on (cookie `w2a_mode=demo`) | turn it off on `/account` |
| `missing_api_key` | `ANTHROPIC_API_KEY` not set on the server | set it and restart / redeploy |
| `user_budget_exhausted` | this user's live tokens today reached `USER_DAILY_TOKEN_BUDGET` | wait for UTC midnight or raise the env var |
| `global_budget_exhausted` | everyone's live tokens today reached `GLOBAL_DAILY_TOKEN_BUDGET` | same |
| `approved_user` | LIVE | |

`callModel` then repeats the checks right before spending (`gate 1/5` ... `gate 5/5`, the failing one at INFO with `FAIL`), and writes one `usage_log` row whose `outcome` names the first failed check (`mode_demo`, `not_approved`, `user_budget`, `global_budget`, `no_api_key`) or `provider_error`, or `live`. `/admin/usage` lists the last 50 with their request ids.

## Auth decisions

- `src/proxy.ts` logs every request as `[http] INFO GET /path {"user":"usr_2"}` (`"none"` when signed out), and every `/admin` decision as `[auth.proxy] ... auth decision: allow|DENY ... (reason)`.
- Pages that need an account log `auth decision: redirect to /login for /path`; admin pages and actions log `auth decision: allow|deny <what> for usr_N (reason)`.
- Login logs which check failed (`no account with that email` or `password mismatch`) even though the user always sees the same `AUTH_INVALID_CREDENTIALS` message. These lines are server side; in production `_debug` is only sent to admins.
- Signup logs the branch it took (`first account`, `ADMIN_EMAILS`, or pending) and the persona it claimed (`persona emp_269 (...) claimed`).
- Approve and reject log `admin decision: usr_1 <a@x> APPROVED usr_2 <b@x> at <ISO time> (was pending)`.

### Redaction

Before any line is written (server and client) `src/lib/log-format.ts` redacts:

- values of keys named like `password`, `secret`, `token`, `apiKey`, `authorization`, `cookie`, `session`, ...
- `sk-...` keys, `Bearer`/`Basic` credentials, JWTs, GitHub/Slack/Google/AWS token shapes
- passwords in connection strings, including URL-encoded ones
- on the server, the exact value of any env var whose name contains KEY, SECRET, TOKEN, PASSWORD, PRIVATE, CREDENTIAL or DATABASE_URL

Still: never log a secret on purpose. Add a pattern there if a new secret format appears.

## Checking the pipeline works

1. `pnpm dev`, open any page, press Ctrl+`. You should see `cli ... [page] INFO loaded /path` and `srv ... [debug.ping] INFO page load /path` with a request id. Every page load and client navigation emits this pair.
2. `/debug/ui`, click **Error toast from a real request**: a toast with code `RANK_TIMEOUT`, and the drawer shows the server `ERROR` line with a stack.
3. `curl -i localhost:3000/api/health` shows `X-Request-Id`, database status, pgvector version and `_debug`.

## Debugging the synthetic company

- Every seed run (`pnpm seed`, `pnpm db:reset`, the Reseed button) logs one `step <name>: N rows in Xms` line per table and ends with `[seed.summary]` lines: seed and source, row counts, step timings, one line per planted person (team, asks in the last 7 days against their limit, services owned, out of office or fully booked days), one line per scenario (expected answer and traps), and who is over their weekly limit. Scripts run inside a request context, so `grep req_xxxxxx` follows a whole run.
- If the data looks wrong, paste the `seed.summary` lines. If one scenario looks wrong, run `pnpm seed:check` (offline) to see where the expected person and the traps land by similarity alone.
- The same seed string always produces the same company. Dates are relative to the load day, so ages and calendars move with it; calendars also depend on the load day.
- `validateCompany` refuses to load a company whose planted structure is broken (`SEED_INVALID`, with the first problems in the log).
- To ask the database why a ranking happened later: `select rank, score, breakdown from ask_candidates where ask_id = 'ask_1000' order by rank`.

## Known gotchas

- If the browser reload-loops in dev (`GET /` and `[Fast Refresh] rebuilding` repeating), the Turbopack cache is stale: stop the server, `rm -rf .next`, restart.
- `not-found.tsx` is rendered ahead of time by Next, so it must not log on the server; the 404 is logged client side by `NotFoundLogger`.
- React strict mode runs effects twice in development; the page-load ping logs `skipped: page-load ping (because same path ...)` for the second run. That is expected.
- Local Postgres listens on host port 5433, not 5432.
- Routes under a `loading.tsx` stream, so `notFound()` there still returns HTTP 200 (with `noindex` and the 404 page). Look for `branch: render 404` in the log rather than the status code.
- `chrome --headless --screenshot` and `--dump-dom` stop before streamed Suspense boundaries hydrate, so a ToC under a `loading.tsx` looks stuck on its skeleton in those captures. Check with a real page lifecycle instead (Chrome DevTools protocol, or a real browser). Headless Chrome also has a minimum window width of about 500px; use device metrics emulation for 375px checks.
- The render that follows a login, logout or demo toggle action in the same request still sees the old cookie, so its `session:` and `mode=` lines describe the state before the action. The next request is correct. Look at the next request id.
- Locally every request comes from `::1`, so all signup and login attempts share one rate limit bucket. To reset: `delete from rate_limits;`.
- `src/lib/mode.ts` and `src/lib/model.ts` must not import `next/navigation` (directly or through `src/lib/auth.ts`), or scripts that call `callModel` fail with `createContext is not a function`. Request-bound helpers go in `src/lib/mode-request.ts`.
- Scripts need `tsx --conditions=react-server` (already in package.json) so modules that import `server-only` load outside Next.
