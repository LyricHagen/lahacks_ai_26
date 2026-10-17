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
- **Exactly one accent color**, a muted rust, defined once as `--accent` in `src/app/globals.css`. Everything else is the neutral ramp. Status colors are only the accent, `--danger` (muted red) and `--success` (muted green), and must also be distinguishable without color: always include a status word, and the Badge tones differ in weight and case.
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
- New kinds of call are registered in `src/lib/model-purposes.ts` (request, parse, fixture). **Every purpose a user can trigger must ship a demo fixture under `fixtures/demo/`**, and demo results must look identical to live ones: DEMO mode is what judges see.
- Mode is decided only by `resolveMode(user, requestedMode)` in `src/lib/mode.ts` (`currentMode()` in `src/lib/mode-request.ts` for the current request). It logs one line per decision: `mode=demo reason=pending_user user=usr_2: ...`. Reasons: `approved_user`, `signed_out`, `pending_user`, `rejected_user`, `explicit_demo`, `missing_api_key`, `user_budget_exhausted`, `global_budget_exhausted`. Never decide mode anywhere else.

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
src/lib/model-purposes.ts     registry of model call kinds (gate_check, fixture_text) and their demo fixtures
src/lib/usage.ts              read model for /admin/usage
fixtures/demo/*.json          committed demo results read by DEMO mode (never a model call)
src/lib/embed.ts              local deterministic embedding (w2a-hash-256-v1), used by seed AND runtime queries
src/lib/time.ts               timezone helpers (localToUtc, localDate, localTime), no dependencies
src/lib/directory.ts          read model for /directory and /directory/[personId]
src/lib/seed-status.ts        read model for /admin/seed
src/db/                       drizzle client (q, qIn for transactions, closeDb) and schema
src/seed/catalog.ts           hand-written company structure: teams, services, planted people, scenarios, docs
src/seed/generate.ts          seed string to Company (pure, deterministic), embedCompany, validateCompany
src/seed/calendar.ts          14-day calendars, generated at load time from calendar profiles
src/seed/load.ts              Company to Postgres in one transaction, logs [seed.summary]
src/seed/fixture.ts           fixture types, read/write fixtures/company.json
fixtures/company.json         committed company (text plus embeddings); pnpm seed reads it, no model call
scripts/seed.ts, db-reset.ts, generate-fixture.ts, check-scenarios.ts   (run with tsx --conditions=react-server)
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
- "Ask load this week" means asks routed to a person in the last 7 days (`LOAD_WINDOW_DAYS`) against `employees.max_weekly_asks`.
- A signed-in account plays one employee persona (`users.employee_id`, unique). Signup claims the planted `newhire_*` persona first, then the newest unclaimed junior or mid employee with a manager; other planted roles are never claimed. Signed-out visitors act as the default persona `newhire_web` in demo mode.
- Never put planted roles (`planted` in the fixture, `seed.planted` in app_meta) into ranking. They exist only for the scenario table and debugging.
- Promises made in `/privacy` that later prompts must keep: password stored only as a hash; managers see only aggregates with groups smaller than five suppressed; calendars expose only free/busy; no third party analytics; deleting an account removes its profile, asks, drafts and usage rows.

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
| `/onboarding` | new hire profile setup | account | 4 |
| `/dashboard` | home for a signed-in user (demo persona when signed out) | public | 8 |
| `/ask/new` | compose an ask | public, live only if approved | 5 |
| `/ask/[askId]` | one ask: shortlist, explanation, draft, status | public, live only if approved | 6 |
| `/ask/[askId]/draft` | the message draft step | public, live only if approved | 7 |
| `/directory` | browse the synthetic company | public | 2 (built) |
| `/directory/[personId]` | one colleague | public | 2 (built) |
| `/ramp` | weekly ramp plan | public, live only if approved | 9 |
| `/insights` | aggregate, anonymized view for managers | public | 10 |
| `/demo` | guided demo scenario | public, always demo | 11 |
| `/admin/users` | approve and reject accounts | admin | 3 (built) |
| `/admin/usage` | spend by user and purpose, recent calls, gate check button | admin | 3 (built early) |
| `/admin/seed` | regenerate the synthetic company | admin | 2 (built) |
| `/debug` | full-page log viewer (`?view=server` for the ring buffer: dev or admin) | public | 1 (built) |
| `/debug/ui` | primitives gallery (extra, not in the original map) | public | 1 (built) |
| `/api/health` | app, database and pgvector check | public | 1 (built) |
| `/api/debug/ping`, `/api/debug/logs`, `/api/debug/fail` | debug plumbing (`logs` is dev or admin) | public | 1 (built) |

## Build plan (provisional, adjust as prompts arrive)

1. Scaffold, design system, logging, debug drawer, landing, legal pages, stubs. **Done.**
2. Synthetic company data model and seed (`/admin/seed`, `/directory`, `/directory/[personId]`). **Done.**
3. Auth and approval (`/login`, `/signup`, `/pending`, `/admin/users`), LIVE/DEMO modes, the model gate, `/admin/usage`. **Done.**
4. Onboarding profile.
5. Compose an ask, retrieval with pgvector.
6. Ranking and explanation.
7. Availability and draft.
8. Dashboard.
9. Ramp plan.
10. Insights (admin usage was built in prompt 3; extend it if needed).
11. Guided demo.
12. Polish and deploy.

## State of the build (update at the end of each prompt)

- Prompt 1 complete. Verified in a real browser: theme toggle (light, dark, system, persisted, no flash), Ctrl+` drawer and footer button, copy buttons, client and server lines interleaved, `/debug` both views, ToC on `/privacy`, skeletons on `/debug/ui`, no radius or shadow on any element, no horizontal scroll at 375px.
- Prompt 2 complete.
  - Schema (migration 0002): orgs, employees (self-referencing manager_id, embedding vector(256)), skills, employee_skills (proficiency, source, evidence sentence), services (primary and secondary owner, skill_ids, embedding), projects, project_members, documents (embedding), calendar_events, mentorships, asks, ask_candidates (breakdown jsonb), ask_messages, ask_events, users (role user/admin, status pending/approved/rejected, employee_id persona), usage_log. HNSW cosine indexes on employee and document embeddings.
  - Company "Corvid Systems" (freight software), seed `corvid-v1`: 200 people, 8 departments, 19 teams, 3 zones (Pacific, Eastern, London), 25 services, 30 projects, 56 documents, 47 mentorships, 171 seeded asks over 21 days, about 8000 calendar events.
  - Planted (see `/admin/seed` and `grep seed.summary`): 4 overloaded seniors (`over_*`, 7 to 9 asks this week against a limit of 3), 5 decoys (`decoy_*`, profile keyword, never touched the service), 3 unavailable owners (`vac_auth`, `vac_finance` out of office days 0 to 9; `booked_search` fully booked 8 days), default persona `newhire_web` (Web, 10 days in). 13 scenarios with expected answer and traps; 6 are answered by a planted document. `pnpm seed:check` shows similarity alone puts decoys at or near the top (iOS decoy is #1), which is what prompt 6 must beat with ownership, load and availability. Documents rank #1 for all 6 documented questions.
  - Text: the committed fixture is TEMPLATED, because no `ANTHROPIC_API_KEY` was available. `pnpm fixture:generate` with a key rewrites bios, project descriptions and non-planted doc bodies with `claude-haiku-5-5` (path typechecks but has never run; first real run should be watched in the log). Skill evidence and planted docs stay templated on purpose. Seeding warns `TEMPLATED TEXT` every time.
  - Embeddings: local `w2a-hash-256-v1` (hashed lexical features plus an alias table in `src/lib/embed.ts`). No embedding API exists in the app. Prompt 5 must embed queries with `embedText` from the same module; if it switches to a hosted model, regenerate the fixture and change `EMBEDDING_DIMS` plus a migration.
  - Reseed keeps users and usage_log, deletes everything else (asks included), restores user persona links by employee id. `/admin/seed` reseed is admin-only (since prompt 3, in every environment).
  - Verified: `pnpm db:reset` and `pnpm seed` (fixture and generated paths), reseed button end to end (dialog, action, toast, refresh), `pnpm build`, no horizontal scroll at 375px on all new pages, ToC builds on the person page, 404 for unknown person ids.
- Model provider: Anthropic. `MODEL_PRICES` has `claude-haiku-5-5` (0.10 / 0.50 per million tokens). App-level model calls (ranking, drafts) not built yet; the only purposes are `gate_check` and `fixture_text`.
- Prompt 3 complete.
  - Migration 0003: users gain `admin_reason`, `last_login_at`, `rejected_at`, `rejected_by` and a unique partial index on `employee_id`; usage_log gains `mode`, `outcome`, `error_code` and a `created_at` index; new table `rate_limits`.
  - Signup runs under a Postgres advisory lock, so "first account becomes admin" and persona claims cannot race. First account and `ADMIN_EMAILS` addresses are created admin and approved, logged as `WARN FIRST ACCOUNT` / `WARN ADMIN_EMAILS`. Everyone else starts `pending`, role `user`.
  - Login never reveals whether an email exists: same message and code (`AUTH_INVALID_CREDENTIALS`), and an unknown email still pays a bcrypt compare. Only the log says which case it was. Rejected accounts can sign in and see a plain message on `/pending`.
  - Header shows a quiet text label "Demo mode" / "Live mode" (reason on hover, details on `/account#mode`). The Admin nav item shows only for admins. Approved users can force demo with the toggle on `/account` (httpOnly cookie `w2a_mode=demo`).
  - `/admin/usage` was built now (not prompt 10) because spend is metered from this prompt on. Its "Run a gate check" button sends one `gate_check` call through `callModel`.
  - `requireAdmin` now checks in every environment (the development skip is gone), so reseeding from `/admin/seed` needs an admin account locally too. Sign up once: the first account is admin.
  - Verified in a real browser (Playwright, Chromium): first signup lands on `/admin/users` as admin with persona `newhire_web`; second signup lands on `/pending` with its own persona and manager; a non-admin opening `/admin/users` is redirected to `/denied`; signed out is redirected to `/login?next=`; approve and reject (with confirm dialog) update the table and the target's next page; wrong password and unknown email give the identical error; the 11th login attempt in 15 minutes gets `RATE_LIMITED`; session and mode cookies are httpOnly; demo toggle and logout work; no horizontal scroll at 375px on every new page. Live path verified with a fake key from a script: all five checks pass, the provider 401 falls back to the fixture, a usage row is written. **A real live call has not run yet** (no `ANTHROPIC_API_KEY`).
