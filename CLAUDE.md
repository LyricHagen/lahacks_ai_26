# Who2Ask: instructions for every session

Who2Ask is a web app for new hires. A new hire describes a problem in plain words; the app finds the right colleague to ask, explains why that person, checks when they are free, and drafts the message. **The human always sends it themselves.** All company data is synthetic.

This project is built over about 12 prompts, each in a fresh session. This file and `DEBUGGING.md` are the memory between sessions. Read both before writing code. Update the "Build plan" and "State of the build" sections at the end of every prompt.

Also read `AGENTS.md` (written by `next dev`): this is Next.js 16, and its docs live in `node_modules/next/dist/docs/`. Check them before using an API you remember from older versions (for example, `middleware.ts` is now `src/proxy.ts`, and route `params` are Promises).

---

## NON-NEGOTIABLE: UI/UX RULES (verbatim from the product owner)

> **UI/UX RULES**
> UI/UX should be somewhat minimalistic. Dark and light mode + skeleton loaders + ToC + privacy policy. Do NOT include the following: gradients, lucide icons, rainbow coloring, drop shadows, 3 feature cards in a row, emojis, liquid glass, em dashes, en dashes, inter/geist/space grotesk, colored left stripe, fake testimonials, bento grids, checkmark bullets, soft corner radii, sparkle icons, dot grids, radial orbs, animated arrows, hover animations, neon colors, basic pastel colors, all pages being under the same parameterless url.

### NON-NEGOTIABLE: consequences of those rules

- **Border radius is 0 everywhere.** Depth comes from 1px borders and background steps (`bg-bg`, `bg-raised`, `bg-sunken`, `bg-strong`), never shadows. `globals.css` forces `border-radius: 0` and `box-shadow: none` on every element, and Tailwind's radius, shadow and default color scales are deleted, so `rounded-*`, `shadow-*` and `bg-blue-500` do not exist.
- **Typography:** IBM Plex Sans for UI (`font-sans`), IBM Plex Mono (`font-mono`) for data, IDs, logs and numbers. Self-hosted via `next/font` in `src/app/layout.tsx`. No other fonts.
- **Exactly one accent color**, a violet after `#b742ff` (darkened in light mode, lightened in dark mode so text in it passes 4.5:1), defined once as `--accent` in `src/app/globals.css`. Everything else is the neutral ramp. Status colors are only the accent, `--danger` (muted red) and `--success` (muted green), and must also be distinguishable without color: always include a status word, and the Badge tones differ in weight and case.
- **No decorative icons.** If an icon is genuinely required for comprehension, draw a minimal inline SVG stroke icon in `src/components/icons.tsx`. Never install an icon package.
- **No em dashes or en dashes** in ANY user-facing copy, code comment, or seeded data. Use commas, colons, or parentheses.
- **Motion:** transitions are limited to color/opacity changes under 120ms on focus and active states. Nothing moves on hover. Skeletons are static (no shimmer, no pulse).
- **Every page has its own real URL with real path segments.** No modal-only views for anything a user might link to. Tabs are links (`src/components/ui/tabs.tsx`). `Dialog` is only for confirmations and short forms.
- No component library. Primitives are hand built in `src/components/ui`.
- Layout must work at phone width with no horizontal page scroll. Wide tables scroll inside their own container (`Table` does this).

**Enforcement:** run `pnpm check` (typecheck plus `scripts/check-rules.mjs`) before finishing any prompt. The rules script scans `src`, `drizzle`, `docker`, `scripts`, `data` and the root docs for dashes, emoji, icon or component packages, rounded/shadow/gradient/blur classes, hover motion, animation utilities and banned fonts. A line can opt out only if it documents a rule, by containing the marker `rules-allow`.

## NON-NEGOTIABLE: logging and debugging

The owner debugs by pasting log output into a new session and cannot see the screen. Logging is a feature. **Follow `DEBUGGING.md` for every server action, API route, query, model call and branch.** In short:

- Server: `const log = createLogger("area.thing")` from `@/lib/log`. Client: same call from `@/lib/client-log`.
- API routes: `export const GET = withRoute("name", async (req) => ok({...}))`. Server actions: `withAction("name", fn)`. Server component pages: `return withPage("name", async () => ...)`. All from `@/lib/request-context`.
- Database: every query through `q("label", (db) => ...)` from `@/db`.
- Model calls: only through `callModel` from `@/lib/model` (see the model gate rule below). It uses `trackModelCall` from `@/lib/model-log` internally; every model needs a price entry in `MODEL_PRICES`.
- Client calls: `apiFetch` / `runAction` from `@/lib/api-client`, never bare `fetch`.
- Errors: never swallow. Log with `{ err }`, throw or return an `AppError` with a code from `src/lib/errors.ts`, and show that code in the UI via `ErrorState` or a toast.
- Log every branch with `log.branch(chose, reason)` and every skip with `log.skip(what, reason)`.

## NON-NEGOTIABLE: the model gate (live vs demo)

Model calls cost the owner real money and the app may be public. So:

- **Every model call in this codebase goes through `callModel({ purpose, input, user, mode })` in `src/lib/model.ts`. Nothing calls a provider SDK directly, ever.** `@anthropic-ai/sdk` is imported in `src/lib/model.ts` and nowhere else, including scripts (`scripts/generate-fixture.ts` uses `callModel` with a `ScriptActor`, which is refused inside the web server).
- `callModel` checks, in order, logging each one: mode is live, user is approved, user under `USER_DAILY_TOKEN_BUDGET`, global `GLOBAL_DAILY_TOKEN_BUDGET` not exhausted, `ANTHROPIC_API_KEY` exists. Any failure, and any provider error, returns `{ source: "fixture", output, note }` from the purpose's committed demo fixture instead of throwing (or `{ source: "none", code: "MODEL_FIXTURE_MISSING" }` if there is none). The UI shows `note` (a plain "Cached demo result: ..." line) whenever `source !== "live"`.
- Every call writes exactly one `usage_log` row, whatever the outcome (`outcome` = `live` or the failed check).
- New kinds of call are registered in `src/lib/model-purposes.ts` (request, parse, fixture, key). **Every purpose a user can trigger must ship a demo fixture under `fixtures/demo/`** (the deterministic builder) **and a `key()` plus a file in `fixtures/model/`** (recorded live answers), and demo results must look identical to live ones: DEMO mode is what judges see.
- **Demo results, in order** (`fallback()` in `src/lib/model.ts`): the recorded live answer for this exact input (`fixtures/model/<purpose>.json`, keyed by `fixtureKey` in `src/lib/model-fixtures.ts`: sha256 of the purpose's normalized `key(input)` with ask ids numbered; logged `fixture HIT`), else the deterministic builder (`fixture MISS ... hash=...`). A recording is the model's raw JSON and is replayed through the same `parse()` and the same fact and grounding checks as a live answer. `pnpm fixtures:record` (owner, with the key) writes them; `--dry-run` rehearses without a key; `--only-missing` pays only for new inputs. Calendars depend on the load day, so a reseed on another day makes explain/draft recordings miss: record after the last reseed. `pnpm demo:check` shows the hit rate.
- Scripts that need live calls wrap their work in `runAsScript({ actor, record, preferRecorded, onFixture })`: the gate then sees the script actor (refused inside the web server), and every live answer goes to `record`. Script mode comes from `resolveScriptMode` (reason `owner_script`).
- Mode is decided only by `resolveMode(user, requestedMode)` in `src/lib/mode.ts` (`currentMode()` in `src/lib/mode-request.ts` for the current request). It logs one line per decision: `mode=demo reason=pending_user user=usr_2: ...`. Reasons: `approved_user`, `signed_out`, `pending_user`, `rejected_user`, `explicit_demo`, `missing_api_key`, `user_budget_exhausted`, `global_budget_exhausted`, `demo_account` (the shared guided demo account, always demo), `owner_script` (`resolveScriptMode`, scripts only). Never decide mode anywhere else.

## NON-NEGOTIABLE: the clock

- **Nothing in the app may call `Date.now()` or a bare `new Date()`.** All time comes from `src/lib/clock.ts`; `pnpm check` fails on either anywhere else (scripts included).
- **App time** is "now" for anything about the synthetic company: calendars, availability, ask load, tenure, recency of work. Get it with `await getClock()` (`src/lib/clock-request.ts`, memoized per request) in server code, `demoClock()` (`src/lib/clock-server.ts`) in scripts, and pass `now` into pure code. In demo mode it is **pinned** to `demoInstant(seed.anchor_day)`: the first weekday on or after the load day, 10:20 Pacific. Every time display of company time uses it. One log line per request: `clock=pinned now=... reason`.
- **Wall time** (`wallNow()`, `wallMs()`) is only for infrastructure: log stamps, run leases, rate limits, budgets, pacing, the 24 hour cooldown, and audit timestamps (when a row was really written, ask history, `rankedAt`).

---

## Stack

- Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS 4 (CSS-first config in `src/app/globals.css`, no `tailwind.config`). Package manager: **pnpm**.
- Auth.js v5 (`next-auth@5.0.0-beta.32`), credentials provider only, bcrypt (`bcryptjs`, 12 rounds), JWT session in an httpOnly cookie. Env: `AUTH_SECRET` (required), `ADMIN_EMAILS` (comma separated, promoted on signup). No `/api/auth` route on purpose: sign in happens only through the rate-limited server action.
- Postgres with pgvector via Drizzle ORM (`postgres` driver). One env var: `DATABASE_URL`. Local: `docker compose up -d db` (host port **5433**, because 5432 is often taken). Neon/Vercel: paste the pooled URL; `src/db/index.ts` turns off prepared statements for pooled hosts.
- Migrations: edit `src/db/schema.ts`, then `pnpm db:generate` and `pnpm db:migrate`. Migration 0000 enables `vector`. Use `vector("embedding", { dimensions: N })` for embeddings.

## Layout of the code

```
src/proxy.ts                  request id per request, /admin guard with a DB role check (Next 16's name for middleware)
src/lib/log.ts                server logger, AsyncLocalStorage, 500-line ring buffer
src/lib/log-format.ts         shared line format, redaction, error serialization
src/lib/client-log.ts         client logger
src/lib/debug-store.ts        client session log store (drawer and /debug)
src/lib/api-client.ts         apiFetch / runAction: ingest _debug, map errors to codes
src/lib/request-context.ts    withRoute / withAction / withPage, isDebugAllowed
src/lib/errors.ts             ERROR_CODES and AppError
src/lib/model-log.ts          trackModelCall, MODEL_PRICES
src/lib/auth-config.ts        Auth.js setup (credentials, JWT cookie); exports auth, signIn, signOut
src/lib/auth.ts               getSessionUser (memoized per request, role/status from DB), requireUser, requireAdmin
src/lib/accounts.ts           signup (first account admin, ADMIN_EMAILS, persona claim), verifyCredentials, admin approve/reject
src/lib/auth-actions.ts       server action bodies: login, signup, logout, demo toggle, approve, reject, gate check
src/lib/rate-limit.ts         per-IP fixed window limits in Postgres (signup 5/hour, login 10/15 min)
src/lib/mode.ts               resolveMode (the only mode decision), MODE_REASON_LABEL; no next/* imports
src/lib/mode-request.ts       getRequestedMode (w2a_mode cookie), currentMode()
src/lib/budget.ts             daily token budgets from env, getBudgetState
src/lib/model.ts              callModel: THE model gate, the only importer of the provider SDK
src/lib/model-purposes.ts     registry of model call kinds (gate_check, fixture_text, understand_ask, explain_ranking, draft_ask, ramp_plan) and their demo fixtures
src/lib/usage.ts              read model for /admin/usage
fixtures/demo/*.json          committed demo results read by DEMO mode (never a model call)
src/lib/embed.ts              local deterministic embedding (w2a-hash-256-v1), used by seed AND runtime queries
src/lib/time.ts               timezone helpers (localToUtc, localDate, localTime), no dependencies
src/lib/directory.ts          read model for /directory and /directory/[personId]
src/lib/seed-status.ts        read model for /admin/seed
src/lib/ask-state.ts          THE ask lifecycle: states, phases, allowed transitions, progress steps (no server imports)
src/lib/ask-transition.ts     transitionAsk (the only writer of asks.status), recordCreated, setProgress
src/lib/ask-pipeline.ts       runs processing states; ASK_STEPS registry (prompts 5, 6, 7 add steps here); run lease
src/lib/ask-understand.ts     the understanding step: understand_ask through callModel, fallback, doc check, -> confirming
src/lib/understanding.ts      Understanding shape, Zod schemas, keyword extractor (no server imports)
src/lib/understand-build.ts   catalog, buildUnderstanding, protectUnderstanding (no next/* imports, usable in scripts)
src/lib/doc-check.ts          documents before people: score, threshold, quoted section
src/lib/retrieve.ts           the five retrieval paths, merge and cap; retrieval-paths.ts has client-safe names/types
src/lib/ask-retrieve-step.ts  the retrieving step: run paths, write candidates and asks.retrieval, -> ranking
src/lib/rank.ts               THE ranking: RANK_CONFIG (every weight), components, guardrails, shortlist, why-not, template reason (pure, client-safe)
src/lib/rank-inputs.ts        DB to Features (raw 0..1 plus detail per component), cooldown lookup (no session, usable in scripts)
src/lib/clock.ts              THE clock: wallNow/wallMs, demoInstant, pinnedClock (no imports but time.ts)
src/lib/clock-server.ts       loadAnchorDay, demoClock (scripts); clock-request.ts: getClock() for requests
src/lib/availability.ts       THE availability engine calendar-v2: hard/soft/free blocks, analyze, nextWindow, recommendChannel, overlapHours, loadsThisWeek, weekStrip, availabilityForPerson
src/lib/availability-types.ts client-safe shapes: WindowView, Recommendation, ChannelRule, WeekStripData
src/lib/ask-rank-step.ts      the ranking step: score, guardrails, explain_ranking with fact check, write, -> shortlist
src/lib/explain-check.ts      fact check for model reasons (tokens must appear in the evidence; no gendered pronouns)
src/lib/draft.ts              THE draft definition: variants (short, full, call), formats (slack, email, invite), DraftInput, groundDraft, copyText, word limit (client-safe)
src/lib/ask-draft-step.ts     the drafting step: scrub, input payload, draft_ask through callModel, grounding per variant, ask_messages rows, -> ready
src/lib/ask-outcome.ts        after the draft: autosave, copy note, "I sent this" (load before/after), "They answered", try next person, followUpFor
src/lib/ask-confirm.ts        confirm action body: corrections, doc verdicts, -> retrieving | answered
src/lib/ask-review.ts         read model for the ask page: doc checks, candidates
src/lib/asks.ts               create and submit, access check (assertAskAccess), detail, dashboard lists
src/lib/ask-actions.ts        server action bodies: create, abandon, retry, confirm, choose (shortlist -> drafting)
src/lib/ask-examples.ts       composer examples, each checked against the loaded services
src/lib/dashboard.ts          dashboard across asks: attentionFor (stale, overdue, waiting on you), recentRecipients (spread note)
src/lib/ramp-types.ts         RampPlan shape, RAMP_MIN_ASKS (3), sections (client-safe)
src/lib/ramp-signals.ts       THE ramp inputs: ask history, skill gaps (RAMP_CONFIG), pools of real docs/people/projects (no next/* imports)
src/lib/ramp-build.ts         buildRampPlan: empty state, signature reuse, ramp_plan through callModel, fact check, ramp_plans upsert (script-safe)
src/lib/ramp.ts               request wrapper (getRampView, rampSummary for the dashboard), dismiss and undo
src/lib/k-anon.ts             THE k-anonymity threshold for /insights: kAnon(panel, cell, count, value), K_MIN_ASKS 5, logs every suppression
src/lib/insights.ts           read model for /insights: opt-in (app_meta insights.opt_in), topics, services vs docs, doc failures, routing load
src/lib/library.ts            read model for /docs/[docId] and /projects/[projectId]
src/lib/model-fixtures.ts     recorded live answers (fixtures/model/*.json): fixtureKey (hash, ask ids numbered), placeholders, lookup
src/lib/demo-script.ts        THE guided demo definition (client-safe): persona key, steps and their URLs, guided ask, ask history
src/lib/demo.ts               demo state (app_meta demo.state), resetDemo (one click, logs everything), buildDemoAsk, actAs (preset session/mode/clock)
src/lib/demo-actions.ts       enter (sign in to the demo account) and reset actions; demo-view.ts: read model for /demo pages
src/seed/demo-persona.ts      the demo persona (newhire_backend), added at load time so no seeded id shifts
src/components/demo/          DemoBanner (top of every page, Reset demo), step frame (nav, narration, prev/next), send panel, read-only mock
scripts/record-fixtures.ts    pnpm fixtures:record; scripts/demo-check.ts: pnpm demo:check (reset + story invariants + hit rate)
src/components/charts.tsx     hand-drawn SVG charts: Bar, BarList, WeekLine, Sparkline, ConcentrationCurve, Suppressed
src/components/ramp/          RampPage (shared by /ramp and /ramp/next), RampItemControls (dismiss, undo)
src/seed/doc-history.ts       seeded "doc did not answer" verdicts for seeded asks (planted failing docs), generated at load
src/lib/viewer.ts             getViewer (account or signed-out visitor), default persona, w2a_visitor cookie
src/lib/onboarding.ts         profile steps, defaults, persona options and switch
src/lib/onboarding-actions.ts server action bodies for /onboarding
src/components/availability/  WeekStrip (+ skeleton, legend), RecommendationBox, StripSlot, PersonAvailabilityPanel
src/components/ask/           AskProgress, AskStateBadge, NotBuiltPanel, LiveStatus (polling), AskHistory, controls, Shortlist (tune control), FollowUpCard
src/components/draft/         DraftProvider + DraftWorkspace (editor state lives in the draft layout), MessageMock (Slack DM, email, invite), GroundingReport
src/db/                       drizzle client (q, qIn for transactions, closeDb) and schema
src/seed/catalog.ts           hand-written company structure: teams, services, planted people, scenarios, docs
src/seed/generate.ts          seed string to Company (pure, deterministic), embedCompany, validateCompany
src/seed/calendar.ts          14-day calendars, generated at load time from calendar profiles
src/seed/load.ts              Company to Postgres in one transaction, logs [seed.summary]
src/seed/fixture.ts           fixture types, read/write fixtures/company.json
fixtures/company.json         committed company (text plus embeddings); pnpm seed reads it, no model call
scripts/seed.ts, db-reset.ts, generate-fixture.ts, check-scenarios.ts, check-ask-state.ts, check-retrieval.ts, check-ranking.ts, check-draft.ts, check-ramp.ts   (run with tsx --conditions=react-server)
scripts/record-fixtures.ts, demo-check.ts   load the request pipeline (session code), so they run WITHOUT react-server and with --require scripts/lib/no-server-only.cjs
src/components/ui/            Button, ButtonLink, Input, Textarea, Select, Field, Card, Table,
                              Badge, Tabs, Dialog, Toast, EmptyState, ErrorState, Skeleton set
src/components/toc.tsx        self-building table of contents (h2/h3 inside a root id)
src/components/doc-layout.tsx long-form page with ToC (privacy, terms)
src/components/stub-page.tsx  "Not built yet, prompt N" placeholder
src/components/debug/         drawer, /debug console, LogView, UI gallery
scripts/check-rules.mjs       UI rule checker
```

## Conventions

- Pages that load data render a skeleton of the same shape while loading (`loading.tsx` or `Suspense` with `SkeletonList`, `SkeletonTable`, `SkeletonCard`, `SkeletonText`). Never a spinner.
- Long pages use `DocLayout` or `Toc` directly.
- Every loading, empty and error state is designed: `EmptyState`, `ErrorState` (shows code and request id).
- IDs shown to users (`ask_12`, `emp_104`, `req_8f3a1c`) are mono.
- `/debug/ui` shows every primitive in both themes. Add new primitives there.
- Synthetic data rules: dates in the fixture are day offsets from the load day; calendars are generated at load. IDs: `emp_101`.., `svc_billing`, `skl_kafka`, `prj_01`, `doc_...`, seeded asks `ask_1`..`ask_999`, app asks from sequence `ask_1000`+, users `usr_N`.
- "Ask load this week" means `sent` transitions (ask_events) addressed to a person in the last 7 days of app time (`LOAD_WINDOW_DAYS`, `loadsThisWeek`) against `employees.max_weekly_asks`. The recipient is `data.recipientId` on the event (written by "I sent this"), else `asks.routed_to_id` (seeded history), so an ask rerouted to the next person counts once for each person it was really sent to.
- A signed-in account plays one employee persona (`users.employee_id`, unique). Signup claims the planted `newhire_*` persona first, then the newest unclaimed junior or mid employee with a manager; other planted roles are never claimed. Signed-out visitors act as the default persona `newhire_web` in demo mode.
- Never put planted roles (`planted` in the fixture, `seed.planted` in app_meta) into ranking. They exist only for the scenario table and debugging.
- **The ask lifecycle** is defined once in `src/lib/ask-state.ts`: `draft -> understanding -> confirming -> retrieving -> ranking -> shortlist -> drafting -> ready -> sent -> answered | stale | abandoned` (plus fallbacks: processing states back to `draft` on failure, `confirming -> answered` when a document answers it, `shortlist -> ranking`, `ready -> drafting|shortlist`, `stale -> sent`). **Never update `asks.status` directly**: call `transitionAsk({ askId, to, expectFrom?, actor, actorId, reason })`. It checks the move, writes one `ask_events` row (from, to, actor, actor id, reason, request id) and logs one line. Illegal moves throw `ASK_ILLEGAL_TRANSITION`; a stale `expectFrom` throws `ASK_STATE_CONFLICT`. Adding a state means: the enum in `schema.ts` (migration), `ASK_STATES`, `ASK_STATE_DEFS`, `ASK_TRANSITIONS`, then `pnpm ask:check`.
- **Ranking** is decided only by `rankCandidates` in `src/lib/rank.ts` (pure, no model). Every weight and threshold is in `RANK_CONFIG`; change it there and run `pnpm rank:check`. The model (`explain_ranking`) only writes reasons, from evidence and breakdown alone, and `checkReason` drops any sentence with a fact not in them. The four guardrails (hard cap, out of office, 24 hour cooldown, spread) must keep reporting fired or not with a reason. Availability reaches ranking only through `AvailabilityProvider` (`calendarAvailability`). Set `asks.routed_to_id` only when the message is sent (that is what counts toward load).
- **Availability** is decided only in `src/lib/availability.ts` (`AVAILABILITY_CONFIG`). Blocks are hard busy (meeting, 1:1, standup, interview, ooo), soft busy (focus) or free (office hours, gaps), inside 09:00 to 17:30 in the person's own zone, over 14 days. Focus time counts as open only for `blocked_now` (`softInterruptible`). The channel recommendation (`recommendChannel`) has five rules: `blocked_now_free_within_hour` (call or DM for 10 minutes), `blocked_now_other_owner` (DM the other owner, never one at their limit or out of office), `blocked_now_no_slot`, `blocked_today_async`, `curious_async`. The default is to not interrupt anyone. Windows are shown in the asker's zone with the person's local time in parentheses. Load this week (`loadsThisWeek`) counts asks routed to someone whose `sent` transition in ask_events is within the last 7 days of app time; ranking, the directory and the seed summary all use it.
- **Processing work** (understanding, retrieving, ranking, drafting) is a step in `ASK_STEPS` (`src/lib/ask-pipeline.ts`): `async ({ askId, progress }) => ({ to, reason, data })`. Call `progress("searching 200 people")` for the live status line. The runner handles the lease, pacing (`ASK_STEP_MIN_MS`), transitions and failure (back to `draft` with `last_error_code`). `/ask/[askId]` runs it via `POST /api/asks/[askId]/run` and polls `GET /api/asks/[askId]`. A processing state without a step parks the ask and shows `NotBuiltPanel`; a review/outcome state gets its screen by adding an entry to `PANELS` in `src/app/ask/[askId]/page.tsx`.
- **Ask ownership:** an account's asks have `user_id`; a signed-out visitor's asks have `visitor_id` (httpOnly `w2a_visitor` cookie, set when they first ask). `assertAskAccess` allows the owner, the same visitor, admins, and anyone for seeded history (read only); everything else gets a 404 (`ASK_NOT_FOUND`), with the real reason in the log.
- **Confidential notes** (`asks.confidential`) must never be logged, shown to the recipient or sent to a model. `confidential` is a redacted key name, and `markSensitive(value)` (`src/lib/log.ts`) scrubs the exact text from every later line of the request (SQL trace included). The drafting step reads it only to leave it out. `next.config.ts` turns off Next's dev logging of server function arguments for the same reason.
- **Drafting never sends.** The app drafts, the asker edits, copies and sends from their own Slack, mail or calendar, then clicks "I sent this". There is no send button and no integration. The draft input (`DraftInput`, `src/lib/draft.ts`) is built only from the confirmed understanding, what was tried, the recipient, the relationship, the evidence, the channel recommendation and a 15 minute slot (`nextWindow`); sensitive spans and the confidential note are removed before it exists. Every variant goes through `groundDraft`: a sentence naming a service, repo, project or person not in the input is stripped and logged. New draft wording for demo mode goes in `fixtures/demo/draft_ask.json`; run `pnpm draft:check`.
- **After sending:** `ready -> sent` (markSent: recipient on the event, `asks.routed_to_id`, `sent_at` wall, `sent_app_at` app time), then `sent|stale -> answered` (markAnswered: `answered_via=person`, optional `answer_note`) or `sent -> stale -> drafting` (tryNextPerson). A document answer at the confirm step sets `answered_via=document`, `answered_doc_id`. `/insights` reads these columns. The follow-up horizon is `horizonWorkingDays` per urgency, measured as real time since the send laid onto the app time of the send.
- **Onboarding profile** (`user_profiles`): `knownSkillIds`, `firstFocus`, `preferredChannel` (slack, email, call), `okToInterruptSeniors`. Ranking (6), drafting (7) and the ramp plan (9) read it with `getProfile(userId)`; signed-out visitors and skipped steps use defaults (persona skills at proficiency 2+, persona's active project, Slack, peers first).
- **Ramp plan** (`/ramp`, `/ramp/next`): built only from the owner's own asks past the confirm step plus the seeded company. Under `RAMP_MIN_ASKS` (3) the page says so plainly and no model call runs. Gaps and pools are code (`src/lib/ramp-signals.ts`, `RAMP_CONFIG`); the `ramp_plan` call only picks from the pools and writes sentences, each checked with `checkReason` against that item's facts (falls back to the demo line). Every item links to its row (`/docs/...`, `/directory/...`, `/projects/...`). One stored plan per owner per week (`ramp_plans`, Monday in the persona's zone, app time); it is rebuilt only when the signature (asks, profile, persona; plus dismissals for next week) changes. Dismissals (`ramp_dismissals`) are left out of every later plan and halve their skill's gap score. The person to meet is never the manager, a mentorship partner, someone already sent or chosen, on the learn list, out of office, or at their weekly limit. Run `pnpm ramp:check`.
- **Insights** (`/insights`): aggregate only. Every number goes through `kAnon` (`src/lib/k-anon.ts`, 5 asks); below it the page shows "not enough data" and the log has the count. No ask text, no asker identity; recipients are named only with 5+ sends. The org opt-in is `app_meta` key `insights.opt_in` (the seed writes it on once and never overwrites it; admins flip it on the page); when off, no panel query runs. Seeded doc failures come from `src/seed/doc-history.ts`.
- **The guided demo** (`/demo`, `/demo/{ask,match,message,try}`; the eight old step slugs redirect, `DEMO_STEP_ALIASES`): one shared account (`users.is_demo`, `demo@who2ask.invalid`, status approved but always demo mode via `resolveMode` and gate 2) playing the planted `newhire_backend` persona (Robert Barajas, he/him (`DEMO_PERSONA_PRONOUNS`), Backend Engineer I, Payments, 11 days in at the pinned clock; added at load in `src/seed/demo-persona.ts`; never claimable by signup or the persona switch). "Start the demo" signs in through the Auth.js provider `demo` (no password, reachable only from the action). Step pages read the guided ask whoever looks (shared demo data); acting needs the demo account. Asks by the demo account and by signed-out visitors have `source = 'demo'`. **Reset demo** (banner, every page; demo account, signed-out visitors and admins) deletes every `source = 'demo'` ask, demo ramp plans/dismissals and the `ask:` rate limit windows, re-links the account and its profile, and rebuilds the history and guided ask through the real pipeline in demo mode at the pinned clock (about 0.5s), then logs every load counter that moved. Change the story in `demo-script.ts`, then run `pnpm demo:check`.
- **Retrieval's sixth path, `manager`**, runs only when the other five found nobody: the asker's manager and skip-level, so an ask the company data does not cover still reaches a shortlist and a draft.
- Promises made in `/privacy` that later prompts must keep: password stored only as a hash; managers see only aggregates with groups smaller than five suppressed; calendars expose only free/busy; no third party analytics; deleting an account removes its profile, asks, drafts, ramp plans, dismissals and usage rows; insights shows no ask text and no asker, and exists only while the org is opted in; a confidential note is never shown to the recipient, sent to a model or logged; the shared demo account never sends text to a model, and Reset demo deletes every demo ask.

## Route map

Every route exists. Stubs render "Not built yet, prompt N". Access levels:

- **public**: anyone, signed in or not. Model-backed features run in DEMO mode unless the visitor is approved.
- **account**: needs sign in; the page redirects to `/login?next=...` (logged as `auth decision: redirect to /login`).
- **admin**: blocked in `src/proxy.ts` (signed out goes to `/login?next=`, non-admin to `/denied`, both logged as `auth decision: DENY ...` with path and reason), then checked again by `requireAdmin` in the page and in every action.
- **approved** is not a route level: no page needs approval. Approval only switches model calls from DEMO to LIVE, decided by `resolveMode`.

| Route | Purpose | Access | Prompt |
|---|---|---|---|
| `/` | marketing landing | public | 1 (built) |
| `/privacy` | privacy policy | public | 1 (built) |
| `/terms` | terms | public | 1 (built) |
| `/login`, `/signup` | auth (signed-in visitors are redirected away) | public | 3 (built) |
| `/pending` | pending explanation, or plain "not approved" for rejected | account | 3 (built) |
| `/account` | email, status, persona, mode with reason, demo toggle, log out | account | 3 (built, not in the original map) |
| `/denied` | where the proxy sends non-admins who open `/admin` | public | 3 (built, not in the original map) |
| `/onboarding` | redirects to the first step not done | account | 4 (built) |
| `/onboarding/role`, `/onboarding/context`, `/onboarding/channels` | the three setup steps, each skippable | account | 4 (built) |
| `/dashboard` | ramp line, open asks with age and attention (stale, overdue, waiting on you), who you asked recently with the spread note, activity (demo persona when signed out) | public | 4, 9 (built) |
| `/ask/new` | compose an ask | public, live only if approved | 4 (built) |
| `/ask/[askId]` | one ask in whatever state it is in: progress, live status, confirm panel, doc check, candidates, shortlist (with next window, week strip and suggested channel), draft ready, follow-up card, answered, history | owner, same visitor, admin; seeded asks public | 4 to 8 (built) |
| `/ask/[askId]/draft` | redirects to the sent or suggested variant; explains when there is no draft yet (runs the drafting step if parked there) | same as the ask | 8 (built) |
| `/ask/[askId]/draft/short`, `/full`, `/call` | one draft variant each (tabs are links), editable in place as a Slack DM, email or calendar invite, copy, "I sent this" | same as the ask | 8 (built) |
| `/directory` | browse the synthetic company | public | 2 (built) |
| `/directory/[personId]` | one colleague, with availability (week strip, next window and suggested channel per urgency) | public | 2, 7 (built) |
| `/ramp` | this week's ramp plan (or the honest empty state), dismiss and undo | public, live only if approved | 9 (built) |
| `/ramp/next` | preview of next week's plan, with dismissals applied | public, live only if approved | 9 (built, not in the original map) |
| `/insights` | aggregate, anonymized view: topics, services vs docs, doc failures, routing load, org opt-in | public (toggle: admin) | 9 (built early) |
| `/docs/[docId]` | one seeded document (ramp items and insights rows link here) | public | 9 (built, not in the original map) |
| `/projects/[projectId]` | one seeded project and its people | public | 9 (built, not in the original map) |
| `/demo` | guided demo overview, persona, Start the demo | public, always demo | 10 (built) |
| `/demo/[step]` | the eight guided steps, each its own URL | public (acting needs the demo account) | 10 (built) |
| `/admin/users` | approve and reject accounts | admin | 3 (built) |
| `/admin/usage` | spend by user and purpose, recent calls, gate check button | admin | 3 (built early) |
| `/admin/seed` | regenerate the synthetic company | admin | 2 (built) |
| `/debug` | full-page log viewer (`?view=server` for the ring buffer: dev or admin) | public | 1 (built) |
| `/debug/ui` | primitives gallery (extra, not in the original map) | public | 1 (built) |
| `/api/health` | app, database and pgvector check | public | 1 (built) |
| `/api/asks/[askId]` (GET), `/api/asks/[askId]/run` (POST) | status poll; run the processing steps | ask owner | 4 (built) |
| `/api/debug/ping`, `/api/debug/logs`, `/api/debug/fail` | debug plumbing (`logs` is dev or admin) | public | 1 (built) |

## Build plan (provisional, adjust as prompts arrive)

1. Scaffold, design system, logging, debug drawer, landing, legal pages, stubs. **Done.**
2. Synthetic company data model and seed (`/admin/seed`, `/directory`, `/directory/[personId]`). **Done.**
3. Auth and approval (`/login`, `/signup`, `/pending`, `/admin/users`), LIVE/DEMO modes, the model gate, `/admin/usage`. **Done.**
4. Onboarding, ask composer, ask lifecycle state machine, ask page, dashboard. **Done.**
5. Understanding (model with keyword fallback), editable confirm, doc check, retrieval with pgvector. **Done.**
6. Ranking and explanation. **Done.**
7. Availability (engine, clock, channel recommendation, week strip). **Done.** The draft step moves to prompt 8.
8. Draft, send, follow up, answered. **Done.** The dashboard extension (contacts, ramp items) moves to prompt 9.
9. Ramp plan, the dashboard extension and insights. **Done.**
10. Demo mode as a first-class experience: recorded fixtures, the guided demo, Reset demo. **Done.**
11. Free (the guided demo was built in prompt 10). Candidates: run `pnpm fixtures:record` with the key and commit, live-path verification, admin extensions, the follow-up gaps listed under prompt 8.
12. Polish and deploy.

## State of the build (update at the end of each prompt)

- Prompt 1 complete. Verified in a real browser: theme toggle (light, dark, system, persisted, no flash), Ctrl+` drawer and footer button, copy buttons, client and server lines interleaved, `/debug` both views, ToC on `/privacy`, skeletons on `/debug/ui`, no radius or shadow on any element, no horizontal scroll at 375px.
- Prompt 2 complete.
  - Schema (migration 0002): orgs, employees (self-referencing manager_id, embedding vector(256)), skills, employee_skills (proficiency, source, evidence sentence), services (primary and secondary owner, skill_ids, embedding), projects, project_members, documents (embedding), calendar_events, mentorships, asks, ask_candidates (breakdown jsonb), ask_messages, ask_events, users (role user/admin, status pending/approved/rejected, employee_id persona), usage_log. HNSW cosine indexes on employee and document embeddings.
  - Company "Ferndale Systems" (freight software), seed `corvid-v1`: 200 people, 8 departments, 19 teams, 3 zones (Pacific, Eastern, London), 25 services, 30 projects, 56 documents, 47 mentorships, 171 seeded asks over 21 days, about 8000 calendar events.
  - Planted (see `/admin/seed` and `grep seed.summary`): 4 overloaded seniors (`over_*`, 7 to 9 asks this week against a limit of 3), 5 decoys (`decoy_*`, profile keyword, never touched the service), 3 unavailable owners (`vac_auth`, `vac_finance` out of office days 0 to 9; `booked_search` fully booked 8 days), default persona `newhire_web` (Web, 10 days in). 13 scenarios with expected answer and traps; 6 are answered by a planted document. `pnpm seed:check` shows similarity alone puts decoys at or near the top (iOS decoy is #1), which is what prompt 6 must beat with ownership, load and availability. Documents rank #1 for all 6 documented questions.
  - Text: the committed fixture is TEMPLATED, because no `ANTHROPIC_API_KEY` was available. `pnpm fixture:generate` with a key rewrites bios, project descriptions and non-planted doc bodies with `claude-haiku-5-5` (path typechecks but has never run; first real run should be watched in the log). Skill evidence and planted docs stay templated on purpose. Seeding warns `TEMPLATED TEXT` every time.
  - Embeddings: local `w2a-hash-256-v1` (hashed lexical features plus an alias table in `src/lib/embed.ts`). No embedding API exists in the app. Prompt 5 must embed queries with `embedText` from the same module; if it switches to a hosted model, regenerate the fixture and change `EMBEDDING_DIMS` plus a migration.
  - Reseed keeps users and usage_log, deletes everything else (asks included), restores user persona links by employee id. `/admin/seed` reseed is admin-only (since prompt 3, in every environment).
  - Verified: `pnpm db:reset` and `pnpm seed` (fixture and generated paths), reseed button end to end (dialog, action, toast, refresh), `pnpm build`, no horizontal scroll at 375px on all new pages, ToC builds on the person page, 404 for unknown person ids.
- Model provider: Anthropic. `MODEL_PRICES` has `claude-haiku-5-5` (0.10 / 0.50 per million tokens). App-level model calls (ranking, drafts) not built yet; purposes are `gate_check`, `fixture_text` and (prompt 5) `understand_ask`.
- Prompt 3 complete.
  - Migration 0003: users gain `admin_reason`, `last_login_at`, `rejected_at`, `rejected_by` and a unique partial index on `employee_id`; usage_log gains `mode`, `outcome`, `error_code` and a `created_at` index; new table `rate_limits`.
  - Signup runs under a Postgres advisory lock, so "first account becomes admin" and persona claims cannot race. First account and `ADMIN_EMAILS` addresses are created admin and approved, logged as `WARN FIRST ACCOUNT` / `WARN ADMIN_EMAILS`. Everyone else starts `pending`, role `user`.
  - Login never reveals whether an email exists: same message and code (`AUTH_INVALID_CREDENTIALS`), and an unknown email still pays a bcrypt compare. Only the log says which case it was. Rejected accounts can sign in and see a plain message on `/pending`.
  - Header shows a quiet text label "Demo mode" / "Live mode" (reason on hover, details on `/account#mode`). The Admin nav item shows only for admins. Approved users can force demo with the toggle on `/account` (httpOnly cookie `w2a_mode=demo`).
  - `/admin/usage` was built now (not prompt 10) because spend is metered from this prompt on. Its "Run a gate check" button sends one `gate_check` call through `callModel`.
  - `requireAdmin` now checks in every environment (the development skip is gone), so reseeding from `/admin/seed` needs an admin account locally too. Sign up once: the first account is admin.
  - Verified in a real browser (Playwright, Chromium): first signup lands on `/admin/users` as admin with persona `newhire_web`; second signup lands on `/pending` with its own persona and manager; a non-admin opening `/admin/users` is redirected to `/denied`; signed out is redirected to `/login?next=`; approve and reject (with confirm dialog) update the table and the target's next page; wrong password and unknown email give the identical error; the 11th login attempt in 15 minutes gets `RATE_LIMITED`; session and mode cookies are httpOnly; demo toggle and logout work; no horizontal scroll at 375px on every new page. Live path verified with a fake key from a script: all five checks pass, the provider 401 falls back to the fixture, a usage row is written. **A real live call has not run yet** (no `ANTHROPIC_API_KEY`).
- Prompt 4 complete.
  - Migrations 0004 and 0005: enum `ask_state` replaces `ask_status` (existing rows mapped: resolved to answered, ranked to shortlist, drafted to ready, cancelled to abandoned); asks gain `urgency`, `confidential`, `visitor_id`, `understanding` (jsonb), `embedding` (vector 256), `progress`, `progress_at`, `run_lease_until`, `last_error_code`, `last_error_req_id`; ask_events gain `from_state`, `to_state`, `actor`, `actor_id`, `reason`, `req_id` (kind is `transition` for state changes; seeded `marked_sent` stays a note); new table `user_profiles`. drizzle-kit asks an interactive question when an enum is created and another dropped in one diff, so that change was split in two migrations.
  - Seeded asks load as `sent`/`answered` with transition rows (`seeded history: ...`).
  - Onboarding: signup now goes to `/onboarding/role` (all statuses); login goes there while onboarding is neither finished nor skipped (unless `?next=`). Pending accounts see an approval note on the first step; `/pending` links to setup. Persona switch runs under the signup advisory lock and only offers unclaimed junior/mid colleagues with a manager (or the planted new hire), never planted traps.
  - Pipeline: only `understanding` is built (local, no model call): it names services and skills, stores the embedding, and moves to `retrieving`, where the ask parks with a "not built yet, prompt 5" panel. Status lines: "reading your ask", "checking 25 services and 53 skills ...", "found invoice-worker, build-pipeline and 1 skill in your ask".
  - Rate limit bucket `ask`: 30 new asks per hour per address.
  - `pnpm ask:check` verifies the state machine (enum matches, reachability, terminals) and tries an illegal move, a stale compare-and-set and a missing ask against the database.
  - Verified in a real browser (Playwright, Chromium): signed-out empty dashboard; example fills composer and opens the optional fields; submit lands on `/ask/ask_1000+` and shows each status line under a skeleton for about 2.5s, then the parked placeholder at step 3 of 9; confidential note never on the page or in the server log (`[REDACTED_VALUE]` in the SQL trace); dashboard lists the open ask; abandon with confirm moves to Abandoned; signup goes to onboarding, persona switch to an Identity engineer, context saved and still there after refresh and back, channels finish lands on the dashboard; a second account skips the rest and gets defaults; another account or visitor opening someone's ask gets the 404 page; no horizontal scroll at 375px on all new pages, light and dark. `pnpm build` passes.
- Prompt 5 complete.
  - New review state `confirming` between `understanding` and `retrieving` (migration 0006 adds the enum value; `confirming -> retrieving | answered | abandoned`). Main path is now 10 steps.
  - Migration 0006 also: `asks.retrieval` jsonb (per path: query, rows, people, ms; written as each path finishes); `ask_candidates.rank`/`score` nullable until prompt 6 ranks, new `sources text[]` and `evidence jsonb` (`{kind, path, detail, source, recencyDays}`; `detail` is a sentence); new table `ask_doc_checks` (offered doc, quoted section, why, `verdict` answered|not_answered). The reseed clears it. `not_answered` rows are the "doc failed them" signal for /insights (prompt 10).
  - Understanding: purpose `understand_ask` (Zod schema and JSON schema in `src/lib/understanding.ts`, spec in `model-purposes.ts`). Demo/fallback: `understandFixture` returns the committed result in `fixtures/demo/understand_ask.json` when the ask starts like a composer example, else `extractByKeywords` (service names incl. spaced forms like "ingest pipeline", skill aliases, a service inferred by embedding similarity when none is named, help kind and urgency by wording, artifacts by pattern, sensitive spans: emails, phones, credentials, personal/HR sentences). One `understood via=model|fixture|keywords` line per ask. Keyword hits are always unioned into a model or fixture answer. The composer's urgency wins when it is not the default `blocked_today`.
  - Sensitive spans are `markSensitive`d wherever an understanding is loaded (`protectUnderstanding`), and the key `sensitive` is redacted in logs. Known gap: the `ask.create` action's `enter` line (prompt 4) logs the raw body before any check runs.
  - Doc check (`src/lib/doc-check.ts`): score = mean(whole-doc cosine, best paragraph with title cosine), threshold `DOC_MIN_SCORE` 0.49, second doc only within 0.06. The quote is picked by paragraph alone, leaning to earlier paragraphs, plus the next paragraph when short.
  - Retrieval (`src/lib/retrieve.ts`, step `src/lib/ask-retrieve-step.ts`): ownership, history (project members plus seeded asks routed about the service, read from the seeded candidate row's `breakdown->>'serviceId'`), skill (top 40 rows by proficiency), semantic (pgvector top 12, at least 0.18), authorship. Excludes the asker, never reads `seed.planted`. Merge, then cap at 30 by evidence strength (cap order only, not a ranking), logging who was cut. Then the ask moves to `ranking` and parks (prompt 6).
  - UI: `ConfirmPanel` (editable restatement, chips for services, skills, mentioned things, kind of help, urgency, leave out; the line "The best ask is the one nobody has to answer."; "Yes, this answers it" per doc; "No, find a person" / "Find people"). `LiveStatus` shows `RetrievalCounts` filling in per path while retrieving. Parked ranking shows "People who could help" (counts plus an alphabetical `CandidateList`, every evidence item with its source), the confirmed `UnderstandingSummary`, and the docs offered with their verdicts. `answered` by a doc shows the quote.
  - Request-free helpers live in `src/lib/understand-build.ts` (catalog, `buildUnderstanding`, `askText`, `protectUnderstanding`) so scripts work; client-safe path names and types in `src/lib/retrieval-paths.ts`.
  - `pnpm retrieve:check` (offline, no writes, no model): demo understanding, doc check and retrieval for the 13 planted scenarios and 3 examples. All 6 documented questions get their doc offered (and no person-only question gets one); all 7 expected people are among the candidates, and so are most traps (ranking must beat them).
  - Verified in a real browser (Playwright, Chromium, signed out, demo mode): a typed doc question goes understanding -> confirming with the email as a leave-out chip and the runbook quoted, "Yes, this answers it" ends in Answered with the doc; the "Double charge" example shows the cached reading, chips edited (remove a skill, add a service and a skill), "No, find a person" shows counts appearing per path, then 30 candidates with evidence; confidential note never on the page or in the log; no horizontal scroll at 375px; no console errors. `pnpm check`, `pnpm ask:check`, `pnpm build` pass. **The live `understand_ask` path has not run** (no `ANTHROPIC_API_KEY`); its parser was checked against valid and invalid JSON.
- Prompt 6 complete.
  - Migration 0007: `asks.ranking` jsonb (`RankingSummary` in `src/lib/ask-rank-step.ts`: topId and rankedAt for the cooldown, guardrail reports, why-not, how reasons were written). `ask_candidates` after ranking: `rank` (shortlist position or null), `score`, `breakdown` (`stage: "ranked"`, features, contributions, flags, reasonSource), `explanation`, `chosen`.
  - Scoring: eight components (ownership, skillMatch, recency, availability, mentorFit, proximity, timezone, loadPenalty negative, cubed against max_weekly_asks), positive weights sum to 100, `rank-v1`. Profile skills are discounted (0.35), project role sets contributor value, time zone matters less for asks that can wait, mentorFit leans to peers when `okToInterruptSeniors` is false (default).
  - Guardrails, all logged and shown in a "Fairness checks" table: hard cap (excluded, listed under "Left off the shortlist on purpose"), out of office for the whole horizon (same), cooldown (same #1 for the same account or visitor within 24h moves down unless nobody else clears relevance 0.25), spread (shortlist must include someone who is not an owner or a strong senior expert; adds one, badge "Different angle").
  - Shortlist UI: 3 to 5 bordered rows (name, title, team, reason, next free, "N of M asks this week", score), expandable breakdown table plus evidence linked to the directory, why-not line, tune control (5 stops, client-side re-rank with the same function, logged), "Ask <name>" moves to drafting (parked, prompt 7). Read-only shortlist stays visible after a choice.
  - Reasons: one `explain_ranking` call for the shortlist plus 3 runners up. Demo fixture builds each from the person's strongest evidence sentence plus one reachability fact (`fixtures/demo/explain_ranking.json`); it passes the same fact check.
  - `pnpm rank:check`: all 7 person scenarios put the expected person #1 and no trap #1; hard cap fires in 8 of 9 cases, out of office in 2, the cooldown replay fires everywhere, spread fires for the deploy example at "Most expertise".
  - Verified in a real browser (Playwright, Chromium, signed out, demo mode): Double charge shows the secondary owner #1 with "Astrid owns billing-service but is at their weekly ask limit (7 of 3 ...)", tune re-orders with no request, the same ask again fires the cooldown, SSO fires out of office, deploy at Most expertise fires spread, choosing moves to Drafting, 0px overflow at 375px in dark mode, no console errors. **The live `explain_ranking` path has not run** (no `ANTHROPIC_API_KEY`); the fact check was tested against invented tools, numbers, days, pronouns and false ownership claims.
  - Known limits: availability is the stub (first gap of 30 minutes in the candidate's own working hours, not the asker's); the fact check is token based, so a rephrasing that changes meaning with ordinary words can pass.
- Prompt 7 complete (availability; the draft step was not built and is next).
  - Clock: `src/lib/clock.ts` plus `clock-server.ts` and `clock-request.ts`. Every former `Date.now()` / `new Date()` now goes through it; `scripts/check-rules.mjs` enforces that. Demo pin for the current seed (anchor 2026-10-17, a Saturday): Mon, Oct 19, 10:20 Pacific. `currentMode()` is memoized per request and per render (React `cache`), and the layout uses it, so a page logs one `mode=` line.
  - Engine `calendar-v2` replaces the stub: `analyze` gives the 14 day next window with a reason, the hard and soft block counts, and the urgency horizon score that ranking already consumed (same formula as prompt 6). `Features.availability` gains `window`, `windowReason`, `counts`, `recommendation` (optional, so asks ranked in prompt 6 still render). Owners of the asked services get their calendars and load checked even when retrieval did not bring them in, so "DM the other owner instead" uses real data. `asks.ranking.clock` stores the app time the ask was ranked at; `rankedAt` and the cooldown are wall time.
  - Load moved from `asks.created_at` to the `sent` transition in ask_events (`loadsThisWeek`, `loadSqlFor`), the same for ranking, `/directory`, `/directory/[personId]` and `[seed.summary]`.
  - UI: shortlist rows show the next window, the week strip (streams in behind `WeekStripSkeleton`, one query for all candidates, at the ranking's clock), and a "Suggested:" box with the rule; a demo clock note when pinned. `/directory/[personId]` has an Availability section (strip, working hours, overlap with you, then next window and suggestion for each urgency), streamed behind its own skeleton. `/debug/ui` shows the strip, skeleton and both kinds of suggestion.
  - `pnpm rank:check` now also replays each case at blocked now and curious and checks the rule invariants: 0 problems; rules across cases `blocked_now_free_within_hour` 115, `blocked_now_other_owner` 30, `blocked_now_no_slot` 6, `curious_async` 151; focus time opens for 56 people only when blocked now. All 7 expected people still #1.
  - Verified in a real browser (Playwright, Chromium, signed out, demo mode): "Double charge" at Blocked now gives "DM Sophia asking for 10 minutes" (free now, in focus time), Beatriz's row suggests "DM Sophia instead", every row's strip loads, the demo clock note shows; `/directory/emp_113`, `emp_123` (out of office: `blocked_now_no_slot`) and `emp_205` (fully booked: `blocked_now_other_owner`) show the three urgency rows; 0px overflow at 375px in dark mode; no console errors. `pnpm check`, `rank:check`, `retrieve:check`, `ask:check`, `pnpm build` pass.
  - Known limits: everyone has the same working hours (the seed has none per person); windows are in the candidate's working hours only, and a window outside the asker's own hours is flagged ("outside your working hours") rather than excluded; the existing 7 day calendar table on the person page still shows synthetic event titles.
- Prompt 8 complete (draft, send, follow-up; the dashboard extension was not done and moves to prompt 9).
  - Migration 0008: `asks` gain `draft` jsonb (`DraftSummary` in `src/lib/ask-draft-step.ts`: scrubbed input, suggested variant and format with why, grounding per variant, scrub counts, `sent` with load before and after), `sent_at`, `sent_app_at`, `answered_via`, `answer_note`, `answered_by_id`, `answered_doc_id`; `ask_messages` gain `variant` (unique per ask), `original_subject`, `original_body`, `source`.
  - State machine: `stale -> drafting` added (try the next person). Drafting, ready and sent are built in prompt 8.
  - Drafting step: one `draft_ask` call (purpose in `model-purposes.ts`, JSON with short/full/call each subject and body). Demo fixture `demoDraft` fills committed lines from the input only. Suggested variant: call request when the channel is a call, full context when the recipient is 2+ levels more senior, else short. Format: invite for a call, Slack for a DM, else the asker's preferred channel (email or Slack).
  - Load now follows the recipient on each `sent` event (`loadsThisWeek`, `loadSqlFor`, person page list).
  - UI: `/ask/[askId]/draft/{variant}` with tabs, "Suggested" line, format picker, editable mock, word and character count, warning past 120 words, undo edits, numbered steps (1 Copy, 2 send it yourself, 3 I sent this) with a confirm dialog showing the recipient's load now and after; Why card and Grounding check card. The ask page shows a draft-ready panel, the follow-up card (horizon, deadline, next person, "They answered" dialog with a one line answer, "Ask <next> instead") and the answered panel with the captured line.
  - Verified in a real browser (puppeteer-core with Chrome, signed out, demo mode): "Double charge" with a confidential note drafts for Sophia (full context suggested, 3 levels more senior), all three variants pass grounding, the note is nowhere on the page or in the log; edits survive tab switches and reload; Copy puts exactly the on-screen email (subject and body) on the clipboard; the 120 word warning shows; "I sent this" moved Sophia from 2 to 3 of 3; **a second visitor's billing ask then rerouted to Adrian Kowalski with Sophia EXCLUDED by hard_cap (3 of 3)**; sending to Adrian and "Ask Beatriz instead" went sent -> stale -> drafting and drafted for Beatriz; "They answered" with a line closed the ask and shows it; a doc answer records `answered_via=document`; 0px overflow at 375px dark; no console errors. `pnpm check`, `draft:check`, `ask:check`, `rank:check`, `retrieve:check`, `pnpm build` pass. Test asks were deleted afterwards so `rank:check` matches the seed again (sending changes loads, which changes its expectations).
  - **The live `draft_ask` path has not run** (no `ANTHROPIC_API_KEY`); its parser and the grounding check were exercised only on demo output and hand-written cases.
  - Known limits: the follow-up card cannot turn overdue in a short demo (it needs one to five real working days); the stale state is only entered on the way to the next person; the grounding check looks at names only (services, repos, projects, people), not numbers or times; the asker's sent time on the draft page is not shown.
- Prompt 9 complete (ramp plan, dashboard extension, and /insights, which was planned for prompt 10).
  - Migration 0009: `ramp_plans` (owner usr_N or vis_..., user_id cascade, employee_id, week_start, signature, status, source, plan jsonb; unique owner+week) and `ramp_dismissals` (owner, section, ref_id, skill_id, week_start; unique owner+ref). Both are cleared by a reseed. The seed also writes `ask_doc_checks` history for seeded asks (53 rows, verdict not_answered; planted failing docs `doc_mobile_build_runbook` 13, `doc_billing_overview` 8, `doc_k8s_runbook` 7, `doc_ingest_overview` 5) and `app_meta insights.opt_in` (on, by seed, only when absent).
  - Ramp: gaps score askSkill 3 per ask naming the skill, askService 1 per ask about a service using it, teamCore 1 (catalog `TEAMS[].core` by team name) as a bonus only; known skills x0.4; each dismissal x0.5; top 3 picked greedily so they cover different asks. Pools: per gap one doc (onboarding/how-to first, services you touched, failing docs last, never a doc you already judged) and one person (owns/project/authored evidence, proficiency 3+, under their limit, not out of office); stretch from active projects on the persona's team; meet from owners of services you asked about plus experts, minus anyone already interacted with. Demo picks alternate doc and person per gap.
  - Dashboard: ramp line ("You are 11 days in. ..."), open asks with opened/updated age and an attention badge (stale, overdue follow-up, review state left 24h+) sorted first, "Who you asked recently" (30 days of sends; the spread note at 3+ sends and 50%+ to one person), both streamed behind skeletons.
  - Insights: rules box (aggregated, k=5, no text, no asker, opt-in with the toggle), topics by count (bars) and by week (one line of weekly totals plus a per-topic table), services vs docs with "Gap: write a runbook" (mdm-config, helpdesk-bridge, bi-dashboards), where documentation failed (bars plus table, links to /docs), routing load (stat row, concentration curve, most asked people; 11 of 200 people absorb half of 171 sends). ToC. Charts are hand-drawn SVG in the single accent with a title per mark.
  - `pnpm ramp:check` (offline, no writes, no gate): empty state at 0 and 2 asks, plan items exist and pass the fact check, meet rules, dismissals change next week and lower the skill, kAnon hides counts under 5.
  - Verified in a real browser (puppeteer-core with Chrome): signed-out visitor made 3 asks, `/ramp` shows 3 learn items, a stretch task and someone to meet, each linked; dismissing `doc_ingest_runbook` marks it dismissed and `/ramp/next` replaces it and lists it as left out; one send shows Sophia under "Who you asked recently"; a fresh signup sees "Not enough history for a plan yet, 0 of 3 asks" on `/ramp` and on the dashboard; `/insights`, `/ramp`, `/ramp/next`, `/dashboard`, `/docs/...`, `/projects/...`, `/debug/ui` have 0px overflow at 375px in light and dark; no console errors. `pnpm check`, `ask:check`, `rank:check`, `retrieve:check`, `draft:check`, `ramp:check`, `pnpm build` pass. Test asks were deleted afterwards.
  - **The live `ramp_plan` path has not run.** `.env.local` now has an `ANTHROPIC_API_KEY`, but no live call was made without the owner's go-ahead; its parser and the fact check were exercised only on demo output.
  - Not verified in the browser: the insights opt-in toggle as an admin (non-admin view checked), and the spread note with 3 real sends to one person (logic covered by the branch line `show the spread note`).
  - Known limits: this week's plan is frozen when only dismissals change (they show as "Dismissed"), so a dismissal shows up in next week's plan and in any rebuild; topic weeks are UTC weeks of `created_at` (wall time); the concentration curve is drawn per recipient rank (no names) even where single steps are under 5.
- Prompt 10 complete (demo mode as a first-class experience; the guided demo planned for prompt 11 was built here).
  - Migration 0010: `users.is_demo`. New ModeReasons `demo_account`, `owner_script`. New error codes `DEMO_NOT_READY`, `DEMO_RESET_FAILED`, `DEMO_RESET_BUSY`; rate buckets `demo_reset` (60/h), `demo_enter` (120/h).
  - Recorded fixtures: `fixtures/model/{understand_ask,explain_ranking,draft_ask,ramp_plan}.json` are committed EMPTY. The owner runs `pnpm fixtures:record` once (about 84 small Haiku calls: the guided demo after a reset, then the 6 composer examples as the demo account and as a fresh visitor, both right after a reset and after the guided send), commits the files. Until then every demo result comes from the deterministic path (logged `fixture MISS` with the hash), which is what was verified. The write and replay path was verified with a throwaway self-test (deterministic outputs written as recordings: understand, explain, draft and ramp all HIT on the next reset, recorded text went through the fact check), then the files were emptied again. **No live call was made in this prompt.**
  - Retrieval, ranking and availability make no model call (code only: pgvector with the local `w2a-hash-256-v1` embedding, `rankCandidates`, `calendar-v2`), so they need no fixtures; verified by the server log of the whole browser run: 0 `answered live`, 0 `gate 5/5` lines.
  - Fixed on the way: `/directory` failed in production with Postgres 42702 (`loadSqlFor` rendered a bare "id" inside its correlated subquery); now `EMPLOYEE_ID_SQL`. The relationship sentence for a manager read "an Engineering Manager your manager".
  - Verified with a production build and NO API keys in the environment (`hasKey:false` on every mode line), in fresh incognito contexts (puppeteer-core, Chrome): signed-out Reset, /demo, Start the demo (banner names Robert Barajas, 11 days in), all eight steps (billing-service chip, the webhook secret runbook offered and marked not answered, Sophia #1 with the breakdown open, Astrid excluded by hard cap at 7 of 3 with the why-not, three draft variants, I sent this moved Sophia 2 to 3 of 3), an unseen off-catalog ask (badge reader) through the manager path to a draft, dashboard/ramp/insights populated, Reset from an ask page in about 0.55s putting Sophia back at 2 and 404ing the free-roam ask; a second window that never entered the demo ran Double charge to a draft; 0px overflow at 375px light and dark on every demo page plus /, /directory, /insights, /ramp, /dashboard; no console errors, no ErrorState, no server ERROR lines. `pnpm check`, `ask:check`, `rank:check`, `retrieve:check`, `draft:check`, `ramp:check`, `demo:check`, `pnpm build` pass.
  - Known limits: the demo account is shared, so two judges at once share one history and one guided ask (Reset between judges). Reset also deletes every signed-out visitor's asks site wide. Recordings for explain/draft stop matching after a reseed on another day, and free-roam inputs after more than 24h without a reset (cooldown) or after other sends (load); misses fall back silently and are logged. Entering the demo while signed in to a real account signs that account out.
- Between prompts 10 and 11 (owner request): accent changed from rust to violet after `#b742ff` (light `#8526d9`, dark `#c37dff`, both 5.9:1 or better on the background) with a cool neutral ramp. `NAME_OVERRIDES` in `src/seed/catalog.ts` renames emp_113 Fatima Weber to Sophia Mitchell after the name pick (no other person changes; fixture regenerated with `--no-model`, diff limited to emp_113 and the billing-service overview doc). The demo persona is Robert Barajas (he/him, `DEMO_PERSONA_PRONOUNS`). The guided demo is now 4 steps (`ask` = problem, chips, doc check; `match` = why-not plus a `compact` Shortlist; `message` = the suggested draft plus I sent this; `try`), one sentence per part; the old eight slugs redirect. Verified in Chrome (puppeteer-core): every step in light and dark, I sent this moved Sophia 2 to 3 of 3, `/demo/reroute` redirects to `/demo/match`, 0px overflow at 375px, no console errors; `pnpm check` and every `*:check` pass.
