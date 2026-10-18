# Debugging Altostratus

The owner debugs this app by copying log output and pasting it into a fresh session. **Assume nobody can see the screen, only the log.** Logging is a first-class feature: code without logs is incomplete.

## Getting the log

| Where | How |
|---|---|
| Any page | Press **Ctrl+`** or click **log** in the footer. The drawer shows client lines and server lines (from API responses), newest last. **Copy all** / **Copy last 50** produce plain text ready to paste. Copy respects the filter box. |
| `/debug` | Full-page version for this browser tab's session (persisted in sessionStorage), with **Download**. |
| `/debug?view=server` | The server's in-memory ring buffer: last 500 lines across all requests. Development or admins only. |
| Terminal | `pnpm dev` prints every server line. |
| One request | Filter by its id: `req_8f3a1c`. The id is in the `X-Request-Id` response header, in every JSON body as `reqId`, and in every `ErrorState`. |

Copied text starts with a header line (`# Altostratus log, drawer, last 50, ..., page /ask/new, copied ...`) so the pasted log says where it came from.

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
grep RATE_LIMITED              a network address hit the signup, login or ask limit
grep ask_1000                  one ask's whole life: creation, every transition, status lines, run, access decisions
grep " transition "            every state change of every ask (from, to, actor, reason)
grep ILLEGAL                   a code path tried a move the state machine forbids
grep "\[ask.pipeline\]"        pipeline runs: start, steps, parked states, end
grep "progress:"               every live status line shown on an ask page
grep "understood via="         which path read an ask: model, fixture (composer example) or keywords
grep "understanding JSON"      the full extracted understanding (sensitive spans shown as [sensitive])
grep "\[ask.docs\]"            the doc check: docs considered, scores, offered or not and why
grep "doc verdict"             what the asker said about each offered doc (not_answered feeds /insights)
grep "corrected by"            every correction the asker made on the confirm screen
grep " path "                  each retrieval path: query, rows, people, ms
grep "candidates:"             the final candidate list: id, name, evidence kinds
grep "ask_1000 rank config"    ranking weights, tune, urgency horizon, availability provider, asker zone
grep "ask_1000 score "         one line per candidate: every component raw x weight = points, score, guardrails
grep " guardrail "             each fairness rule per ask: FIRED (with who and why) or not fired (with why)
grep "shortlist:"              the final order with scores
grep "why not"                 the why-not line shown above the shortlist
grep "reason "                 each one-line reason: via=model|demo|template, and any DROPPED sentence
grep "cooldown:"               who this asker already got as #1 in the last 24 hours
grep "ask.shortlist"           client side: tune changes (new order, guardrails) and choices
grep "clock="                  the app time each request used: pinned (demo, with the seed anchor day) or system
grep "availability emp_113"    one person's availability per query: window searched, hard and soft blocks, slot, channel and rule
grep "rule=blocked_now"        every call or DM suggestion and the rule behind it
grep "not offered as the other owner"   an owner skipped as the alternative (at their limit or out of office)
grep "draft input payload"      the full input the draft_ask call got (already scrubbed of sensitive spans and the confidential note)
grep "grounding "              per draft variant: ok, or each STRIPPED sentence and the unknown names in it
grep "draft suggested"         which variant and format the draft page opens with, and why
grep "draft scrub"             how many protected spans were kept out of the draft input
grep "load emp_113"            a recipient's load before and after "I sent this"
grep " sent to "               every send the asker reported: recipient, variant, format, words, load before and after
grep "follow-up"               the follow-up card: waiting or OVERDUE, the horizon, who is next
grep "answered by"             "They answered", with the one line answer if given
grep "outcome: answered"       an ask closed by a document at the confirm step
grep "ramp plan"               each weekly plan: reused, built via=live|demo|template, or NOT ENOUGH HISTORY
grep "ramp gap"                every skill the asks point at, its score and signals; KEPT marks the top 3
grep "ramp pool"               the real rows offered to the ramp_plan call per section, with scores
grep "ramp dismissed"          a dismissal (ref, section, skill, week) and "dismissal undone"
grep "insights panel"          per /insights panel: query, rows, cells shown and suppressed, panel state
grep "k-anon SUPPRESSED"       every cell hidden by the 5 ask threshold, with its count (debug level for zero)
grep "insights gap"            services with 5+ asks and no runbook or how-to
grep "routing load:"           sends, recipients, top 3 share, how many people absorb half
grep "insights opt-in"         the org opt-in state on each /insights render, and admin changes
grep "dashboard attention"     which open asks need the viewer (stale, overdue, waiting on you)
grep "spread note"             why the "you keep asking the same person" note showed or not
grep "onboarding step"         onboarding saves and skips, per account
grep "persona switch"          who now plays which colleague
grep "fixture MISS"            a demo result that had no recorded live answer: purpose and input hash (record it with pnpm fixtures:record)
grep "fixture HIT"             a demo result replayed from fixtures/model/
grep "fixture key"             (trace) the normalized input behind a hash: diff two to see why a recording stopped matching
grep "demo reset"              Reset demo: who pressed it, what it deleted (asks by state, events, drafts, ramp plans, rate limit windows), every load counter that moved, the rebuilt asks, the pinned clock, timing
grep "demo sign in"            someone entered the guided demo (and whose session it replaced)
grep "guided step"             each /demo/<step> view: step, viewer, guided ask and its state
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
| `demo_account` | signed in to the shared guided demo account | log out (it is always demo mode, on purpose) |
| `explicit_demo` | the demo toggle is on (cookie `w2a_mode=demo`) | turn it off on `/account` |
| `missing_api_key` | `ANTHROPIC_API_KEY` not set on the server | set it and restart / redeploy |
| `user_budget_exhausted` | this user's live tokens today reached `USER_DAILY_TOKEN_BUDGET` | wait for UTC midnight or raise the env var |
| `global_budget_exhausted` | everyone's live tokens today reached `GLOBAL_DAILY_TOKEN_BUDGET` | same |
| `approved_user` | LIVE | |

`callModel` then repeats the checks right before spending (`gate 1/6` ... `gate 6/6`, the failing one at INFO with `FAIL`), and writes one `usage_log` row whose `outcome` names the first failed check (`mode_demo`, `not_approved`, `rate_limited`, `user_budget`, `global_budget`, `no_api_key`) or `provider_error`, or `live`. `/admin/usage` lists the last 50 with their request ids.

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

## Debugging an ask

Every ask change is one line, and every line carries the ask id, so `grep ask_1000` reads like a story:

```
[ask.state] INFO ask_1000 transition (new) -> draft actor=user(vis_8a28...) reason="composed on /ask/new"
[ask.state] INFO ask_1000 transition draft -> understanding actor=user(vis_8a28...) reason="submitted from /ask/new"
[ask.pipeline] INFO ask_1000 pipeline start
[ask.state] INFO ask_1000 progress: reading your ask
[ask.understand] INFO ask_1000 understood: 2 services (invoice-worker, build-pipeline), 1 skills (Kubernetes)
[ask.state] INFO ask_1000 transition understanding -> retrieving actor=system reason="understood: mentions ..."
[ask.pipeline] INFO skipped: ask_1000 step retrieving (because it is not built yet (prompt 5); the ask stays parked in retrieving)
[ask.pipeline] INFO ask_1000 pipeline end
```

The same history is in the database and on the ask page (History table, with request ids):

```sql
select at, from_state, to_state, actor, actor_id, reason, req_id from ask_events where ask_id = 'ask_1000' order by at, id;
```

| Symptom | Look for |
|---|---|
| Ask page stuck on the skeleton | `pipeline start` without `pipeline end` (a step hung; the lease frees itself after 60s), or no `POST /api/asks/.../run` at all (client did not start it: check the drawer for `ask.live`) |
| `skipped: ... pipeline run (because another request holds the run lease ...)` | normal for a second tab, and in dev React strict mode runs the effect twice; that caller only polls |
| Ask back in Draft with an error box | `step <state> failed with <CODE>`; the box shows the same code and request id |
| `ASK_ILLEGAL_TRANSITION` | `ILLEGAL transition <from> -> <to>` names the ask, current state, attempted state, actor, and the allowed moves |
| `ASK_STATE_CONFLICT` | two requests raced; the line says which state the ask was really in |
| Someone gets a 404 for an ask | `auth decision: deny ask_N for <viewer> (<reason>), answering 404` |

Status lines are paced: each one stays at least `ASK_STEP_MIN_MS` (default 700ms) so fast steps read as work. Set it to 0 to run at full speed. `pnpm ask:check` checks the state machine itself.

Confidential notes are never in the log. If one ever shows up, search for where the value entered a line and add `markSensitive(value)` (src/lib/log.ts) in that request.

## Debugging understanding and retrieval

Per ask, in order (`grep ask_1000`):

```
[ask.understand] DEBUG branch: ask_1000 understood via=keywords (because mode_demo: services: svc_billing ("similar wording (0.48)") ...)
[ask.understand] INFO ask_1000 understanding JSON {"version":2,"via":"keywords","restatement":"...","services":[...],...}
[ask.docs] INFO ask_1000 doc check: 9 docs considered (8 nearest, 3 about named services), 1 offered in 12ms
[ask.confirm] INFO ask_1000 corrected by usr_2 (parse via=fixture): added service invoice-worker; removed skill Payments
[ask.retrieve] INFO ask_1000 path ownership: services.primary_owner_id, secondary_owner_id for svc_billing -> 1 row, 2 people in 2ms
[ask.retrieve] INFO ask_1000 retrieval: 30 candidates (34 before the cap) by path ownership=3 history=19 skill=20 semantic=11 authorship=3
[ask.retrieve] INFO ask_1000 candidates: emp_120 Adrian Kowalski [project,skill,profile]; ...
```

| Symptom | Look for |
|---|---|
| Wrong services or skills on the confirm screen | the `understood via=` line: `keywords` lists what matched which word; `fixture` names the composer example; `model` means the live answer (keyword hits are always added on top) |
| Live mode but `via=keywords` | the `gate N/5` lines just above say which check failed, or `call understand_ask ... failed live` with the parse error |
| A doc was not offered | `[ask.docs] DEBUG ... doc <id> score ... under 0.49` (score = mean of whole doc and best paragraph); `DOC_MIN_SCORE` in `src/lib/doc-check.ts` |
| Someone is a candidate who should not be | the `candidate <emp> ...` DEBUG line lists each evidence item; `ask_candidates.sources` says which path brought them in |
| Someone expected is missing | `path <name>: ... -> 0 rows` or `skipped: ... path` (no service or skill confirmed); `cap at 30, cut ...` lists people dropped by the cap |
| Check offline | `pnpm retrieve:check` runs demo understanding, the doc check and retrieval for every planted scenario, no writes |

```sql
select employee_id, sources, jsonb_path_query_array(evidence, '$[*].kind') from ask_candidates where ask_id = 'ask_1000';
select document_id, score, verdict, why from ask_doc_checks where ask_id = 'ask_1000';
select retrieval from asks where id = 'ask_1000';
```

Sensitive spans found in an ask (emails, credentials, personal matters) are scrubbed from every log line after the understanding runs. The composer's own `action.ask.create enter` line logs the body as typed, before any check.

## Debugging ranking

Ranking is pure code (`src/lib/rank.ts`); the model only writes the reasons. One ask's ranking log reconstructs the whole decision:

```
[ask.rank] INFO ask_1000 rank config rank-v1 tune=0 weights ownership=32 skillMatch=16 ... loadPenalty=30 urgency=blocked_today horizon="the next 2 working days" ...
[ask.rank] INFO ask_1000 score emp_113 Sophia Mitchell = 69.2 [ownership 0.80x32=+25.6, ..., loadPenalty 0.30x30=-8.9] relevance 0.83 load 2/3 availability free Mon, Oct 19, 09:00 Pacific; shortlist #1; guardrails: none
[ask.rank] INFO ask_1000 score emp_111 Astrid Petrov = ... ; EXCLUDED; guardrails: hard_cap (at their weekly ask limit (7 of 3 asks this week))
[ask.rank] INFO ask_1000 guardrail hard_cap FIRED: Astrid Petrov: at their weekly ask limit ...
[ask.rank] INFO branch: ask_1000 guardrail spread not fired (because Already has a different angle: ...)
[ask.rank] INFO ask_1000 shortlist: #1 emp_113 Sophia Mitchell 69.2, #2 ...
[ask.rank] INFO ask_1000 why not emp_111: Astrid owns billing-service but is at their weekly ask limit ...
[ask.rank] INFO ask_1000 reason emp_113 via=demo: "Sophia is the backup owner of ..."
```

| Symptom | Look for |
|---|---|
| Wrong person on top | their `score` line against #1's: which component differs. Weights live only in `RANK_CONFIG` (`src/lib/rank.ts`) |
| Someone missing from the shortlist | `EXCLUDED` with the rule, or `not shortlisted` (score under `keepAboveShareOfTop` of #1 after the first 3) |
| Guardrail did not fire | its `guardrail <rule> not fired` branch line says why (nobody at the cap, nobody else above the relevance floor, ...) |
| Reason looks like a template | `reason <emp> via=template` says why: the model gave none, or `DROPPED sentence with facts not in the evidence ["Kafka"]` |
| Shortlist order differs after a reload | the client logs `client re-rank at tune 0 differs from the server` (the config changed since this ask was ranked) |
| Availability looks wrong | the `availability <emp>` line for that person (see "Debugging availability" below) |
| Check offline | `pnpm rank:check`: demo understanding, retrieval and ranking for every person scenario; expected person #1, traps not #1, demo reasons pass the fact check, cooldown replayed, tune extremes |

Making each guardrail fire in a demo (signed out is fine): the "Double charge" example fires the weekly limit (the billing owner is at 7 of 3); asking it again within 24 hours fires the cooldown; "SSO login loop" fires out of office; "Failing deploy" with the tune at "Most expertise" fires spread.

```sql
select rank, score, explanation, breakdown->'contributions', breakdown->'features'->'excluded' from ask_candidates where ask_id = 'ask_1000' order by rank nulls last, score desc;
select ranking->'guardrails', ranking->'whyNot', ranking->'explain' from asks where id = 'ask_1000';
```

## Debugging availability

All time about the company is app time from `src/lib/clock.ts`. In demo mode it is pinned, so first check which clock the request used:

```
[clock] INFO clock=pinned now=2026-10-19T17:20:00.000Z (Mon, Oct 19, 10:20 Pacific): mode demo (signed_out), pinned to the seeded calendar window (seed anchor day 2026-10-17)
[availability] INFO ask_1000 availability emp_113 searched 2026-10-19T17:20Z to 2026-11-02 (14 days, 10 working days, Pacific) hard=16 soft=17 urgency=blocked_now focus_time=interruptible slot=now, 10:20 Pacific (10:20 their time) for 430 min, in focus time; channel=dm rule=blocked_now_free_within_hour (in focus time right now, ...)
```

| Symptom | Look for |
|---|---|
| Times look like the wrong day | `clock=` line: pinned uses `seed.anchor_day` (first weekday on or after it, 10:20 Pacific); live uses the real time, and a seed older than 14 days has no calendar left (`skipped: ... calendar for ...`) |
| Someone in focus time shown as free | `focus_time=interruptible` means the ask is Blocked now (`AVAILABILITY_CONFIG.softInterruptible`); for any other urgency focus time is busy |
| Unexpected call or DM suggestion | the `rule=` on their line; only `blocked_now_free_within_hour` and `blocked_now_other_owner` interrupt anyone |
| "DM the other owner" missing | `not offered as the other owner of <service>` (at their limit or out of office), or their window is more than 60 minutes away |
| Load number differs from before | load counts the `sent` transition in ask_events within 7 days of app time (`loadsThisWeek`), not `asks.created_at` |
| Strip stuck on its skeleton | `week strips for N people` DEBUG line, or `week strips failed` with `AVAILABILITY_FAILED` |
| Check offline | `pnpm rank:check` replays every case at Blocked now and Just curious and checks each rule |

```sql
select ranking->'clock' from asks where id = 'ask_1000';
select employee_id, breakdown->'features'->'availability'->'recommendation' from ask_candidates where ask_id = 'ask_1000' and rank is not null order by rank;
```

## Debugging drafts and sending

Drafting is a pipeline step (`src/lib/ask-draft-step.ts`). Per ask, in order:

```
[ask.draft] INFO ask_1000 draft slot for emp_113: 15 min at Mon, Oct 19, 12:00 Pacific (...)
[ask.draft] INFO ask_1000 draft scrub: 1 protected span(s) (0 sensitive, plus the confidential note) kept out of the input; ...
[ask.draft] INFO ask_1000 draft input payload {"askId":"ask_1000","asker":{...},"recipient":{...},"relationship":{...},"question":{...},...}
[ask.draft] INFO ask_1000 draft suggested variant=full format=slack: Sophia is 3 levels more senior than you, ...
[ask.draft] INFO ask_1000 grounding short ok via=demo: every name is in the input (366 names checked), 54 words
[ask.draft] WARN ask_1000 grounding full: STRIPPED body sentence (names something that is not in the input: person Astrid Petrov): "..."
[ask.outcome] INFO ask_1000 copied full as email by vis_...: 97 words, 576 chars to the clipboard
[ask.outcome] INFO ask_1000 load emp_113 before send: 2 of 3 asks this week (app time ..., pinned)
[ask.outcome] INFO ask_1000 sent to emp_113 Sophia Mitchell as full/email (96 words, as drafted); load emp_113 before 2 after 3 of 3 this week: now at their weekly limit, ...
[ask.outcome] DEBUG branch: ask_1000 follow-up waiting (because sent 1 min ago (wall), horizon 2 working days ... next emp_120 ...)
[ask.outcome] INFO ask_1000 answered by emp_113 (via person): "It dedupes on the Stripe event id in the webhook handler"
```

| Symptom | Look for |
|---|---|
| A draft mentions something odd | `grounding <variant>`: only service, repo, project and person names are checked (`knownNames` in `src/lib/draft.ts`); other words pass |
| A sentence vanished from a draft | its `STRIPPED` line names what was unknown; the draft page lists it under "Grounding check" |
| Live mode but the draft looks like the demo | `via=demo` and the `gate N/5` lines just above, or `call draft_ask ... failed live` |
| The second ask did not reroute | the first ask's `sent to` line (load after), then the second ask's `score <emp>` line: `EXCLUDED; guardrails: hard_cap` only once load reaches `max_weekly_asks`; below it, the load penalty only lowers the score. A different visitor or account is needed to see load alone (the same asker also gets the 24 hour cooldown) |
| Load did not go up | `load ... after send is N, expected N+1`: loadsThisWeek counts `sent` transitions by `data.recipientId` (else `asks.routed_to_id`) inside 7 days of app time |
| Follow-up never turns overdue | waiting is real (wall) time since "I sent this", laid onto the app time at that moment (`sent_app_at`); the horizon is `horizonWorkingDays` per urgency |
| Check offline | `pnpm draft:check`: demo drafts for every example and owner pass grounding, stay under 120 words, no dashes; the stripping cases; first person |

```sql
select variant, channel, status, source, length(body) from ask_messages where ask_id = 'ask_1000';
select draft->'grounding', draft->'suggested', draft->'sent' from asks where id = 'ask_1000';
select at, to_state, data from ask_events where ask_id = 'ask_1000' and to_state in ('sent','stale','answered');
select answered_via, answer_note, answered_by_id, answered_doc_id from asks where id = 'ask_1000';
```

## Debugging the ramp plan

Built in `src/lib/ramp-build.ts` from `src/lib/ramp-signals.ts`. Per view (`grep "ramp"`):

```
[ramp.signals] INFO ramp history for vis_9afd... as emp_146: 3 confirmed asks; services billing-servicex1, ...; skills Kafkax1, ...
[ramp.signals] INFO ramp gap skl_kafka Kafka score 3 KEPT: Kafka came up in 1 of your asks (ask_1024)
[ramp.signals] INFO skipped: ramp learn person emp_193 (because at their weekly ask limit (7 of 3))
[ramp.signals] INFO ramp pool learn: doc_flags_overview(4.0), emp_200(5.5), doc_billing_runbook(3.0)
[ramp] INFO ramp plan vis_9afd... week 2026-10-19: learn emp_200 why via=demo: "Kafka came up in 1 of your asks (ask_1024). ..."
[ramp] INFO ramp plan vis_9afd... week 2026-10-19: built via=demo, 3 learn (...), stretch prj_10, meet emp_169; left out 1 dismissed (signature ...)
```

| Symptom | Look for |
|---|---|
| "Not enough history" but the user has asks | `ramp history ... N confirmed asks`: only asks past the confirm step count (not draft, understanding, confirming); `RAMP_MIN_ASKS` is 3. Asks are matched by account, or by the `w2a_visitor` cookie when signed out |
| A gap is missing or odd | its `ramp gap` line (score and signals); weights in `RAMP_CONFIG` (`src/lib/ramp-signals.ts`). A gap needs an ask behind it; team core skills only add a bonus |
| A section says nothing to suggest | `branch: ramp <section> empty` with the reason, and the `skipped: ramp ...` lines (at limit, out of office, already interacted with, dismissed) |
| Live mode but the text looks like the demo | `gate N/5` lines above, or `call ramp_plan ... failed live`; a single sentence with `DROPPED ... facts not in the evidence` falls back to the demo line (badge "Template text") |
| Plan did not change after a new ask | `reused (signature ... unchanged)`: the signature covers asks past confirm, their services and skills, the profile and persona; next week's also covers dismissals |
| Dismissal did not change this week | by design: this week only marks it "Dismissed"; `/ramp/next` and any rebuild leave it out (`left out N dismissed`) |
| Check offline | `pnpm ramp:check` |

```sql
select owner, week_start, status, source, signature, plan->'gaps' from ramp_plans order by created_at desc limit 5;
select owner, section, ref_id, skill_id, week_start from ramp_dismissals;
```

## Debugging insights

Every number on `/insights` passes `kAnon` (`src/lib/k-anon.ts`). One request logs the opt-in state, one `insights panel` line per panel, and one `k-anon SUPPRESSED` line per hidden cell (the hidden count is only in the log). If the org is opted out, `skipped: every insights panel query` and nothing else runs.

| Symptom | Look for |
|---|---|
| Whole page says the org has not opted in | `insights opt-in is OFF` (or `no insights.opt_in in app_meta`): reseed once (the seed writes it when absent) or an admin turns it on with the switch on the page |
| A panel says "not enough data" | its `insights panel` line: `panel suppressed` means every cell was under 5 |
| Doc failures panel is thin | `select document_id, verdict, count(*) from ask_doc_checks group by 1, 2`; seeded history comes from `src/seed/doc-history.ts` (`seeded doc history:` in `[seed.summary]`) |
| Load numbers differ from the directory | insights counts every `sent` transition over all time; the directory counts the last 7 days of app time |

## Debugging the guided demo and recorded fixtures

| Symptom | Look for |
|---|---|
| A step says "The guided ask has no ..." or the demo is not ready | `demo reset ... failed with <CODE>`; `DEMO_NOT_READY` means seed.planted has no `newhire_backend` (seeded before prompt 10): reseed. Then press Reset demo |
| The story changed (a different #1, no runbook offered) | run `pnpm demo:check`: it resets and names each broken part (`PROBLEM ...`) |
| Live text expected but the demo looks deterministic | `fixture MISS <purpose> hash=...`. If the hash is recorded under another value, set LOG_LEVEL=trace and diff the `fixture key` lines of a record run and a demo run |
| `pnpm fixtures:record` reports misses in its replay check | the inputs changed between recording and replay (a reseed, a load change); its log lists the hashes |
| Reset demo refused | `deny demo reset for usr_N` (an ordinary account), `RATE_LIMITED` (demo_reset bucket), or `DEMO_RESET_BUSY` (another reset holds `demo.lock` in app_meta; it frees itself after 60s) |
| An ask about something the company does not have reached the manager | expected: `fall back to the asker's managers` (retrieval path `manager` runs only when the other five found nobody) |

```sql
select value from app_meta where key in ('demo.state', 'demo.lock');
select id, status, user_id, visitor_id from asks where source = 'demo' order by id;
```

## Debugging hardening: validation, rate limits, Sentry

| Symptom | Look for |
|---|---|
| A button shows `BAD_REQUEST` | `input refused by schema: <field> <issue>` on the action's logger (values are never logged). The schemas are in `src/lib/inputs.ts`; an action missing from `ActionInputs` is refused with `No input schema for action ...` (500), so add one with every new action |
| An API route answers 400 | `params refused by schema` or `query refused by schema` on `api.input` |
| `RATE_LIMITED` | `rate limit: deny <bucket> from <ip or usr_N or vis_...>`. Buckets in `RATE_LIMITS` (`src/lib/rate-limit.ts`): `ask`/`ask_owner` (new asks), `ask_run`/`ask_run_owner` (the run route), `model_ip`/`model_user` (live calls, gate check 3/6; a refusal there serves the demo result with outcome `rate_limited`, not an error). Reset locally: `delete from rate_limits;` |
| A live call refused at `gate 3/6` | the rate limit line just above it says which subject is over |
| Was it reported to Sentry? | only 5xx failures from `withRoute`/`withAction` and uncaught render errors (`onRequestError`). Sentry tags `req_id`, so search the issue by the request id from the log line. Spans: `model.<purpose>`, `ask.step.<state>`, `ask.retrieve`, `ask.rank` |

## Known gotchas

- If the browser reload-loops in dev (`GET /` and `[Fast Refresh] rebuilding` repeating), the Turbopack cache is stale: stop the server, `rm -rf .next`, restart.
- `not-found.tsx` is rendered ahead of time by Next, so it must not log on the server; the 404 is logged client side by `NotFoundLogger`.
- React strict mode runs effects twice in development; the page-load ping logs `skipped: page-load ping (because same path ...)` for the second run. That is expected.
- Local Postgres listens on host port 5433, not 5432.
- Routes under a `loading.tsx` stream, so `notFound()` there still returns HTTP 200 (with `noindex` and the 404 page). Look for `branch: render 404` in the log rather than the status code.
- `chrome --headless --screenshot` and `--dump-dom` stop before streamed Suspense boundaries hydrate, so a ToC under a `loading.tsx` looks stuck on its skeleton in those captures. Check with a real page lifecycle instead (Chrome DevTools protocol, or a real browser). Headless Chrome also has a minimum window width of about 500px; use device metrics emulation for 375px checks.
- The render that follows a login, logout or demo toggle action in the same request still sees the old cookie, so its `session:` and `mode=` lines describe the state before the action. The next request is correct. Look at the next request id.
- Next's own dev terminal logging of server function arguments is turned off in `next.config.ts` (it printed raw passwords and confidential notes). After changing `next.config.ts`, if pages start re-navigating by themselves, `rm -rf .next` and restart.
- Locally every request comes from `::1`, so all signup, login, ask and model-call attempts share one per-IP bucket each. To reset: `delete from rate_limits;`.
- Never run prettier or any formatter on this repo: there is no config, and it reflows the long hand-written lines. If it happens, `.next/dev/server/chunks/**/*.map` holds the original source (`sourcesContent`).
- `src/lib/mode.ts` and `src/lib/model.ts` must not import `next/navigation` (directly or through `src/lib/auth.ts`), or scripts that call `callModel` fail with `createContext is not a function`. Request-bound helpers go in `src/lib/mode-request.ts`.
- Modules used by scripts must not import `src/lib/auth.ts` or `src/lib/mode-request.ts` (they pull in `next/navigation`). That is why the understanding helpers live in `src/lib/understand-build.ts` and the step (which needs the session and mode) in `src/lib/ask-understand.ts`.
- Passing a JS `Date` into a raw ``sql`...` `` template fails with `ERR_INVALID_ARG_TYPE`; pass `.toISOString()` with `::timestamptz`, or use drizzle operators (`gte(col, date)`), which serialize it.
- `Toc` gives ids to headings it finds; give every heading inside streamed (Suspense) content an explicit `id`, or hydration fails with a mismatch.
- Scripts need `tsx --conditions=react-server` (already in package.json) so modules that import `server-only` load outside Next. The exceptions are `pnpm fixtures:record` and `pnpm demo:check`: they load the session code (next/navigation needs React's client build), so they run without that condition and stub `server-only` with `--require scripts/lib/no-server-only.cjs`.
- Next 16 refuses a second `next dev` in the same folder. To test with different env (for example no API keys), build and `next start -p <port>` instead.
