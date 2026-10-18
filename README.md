# Altostratus

A new hire describes a problem in plain words. Altostratus finds the right colleague to ask, explains why that person, checks when they are free, and drafts the message. **The new hire always sends it themselves**: there is no send button and no Slack, mail or calendar integration. Every colleague, calendar and document belongs to a synthetic company (Ferndale Systems, 200 people), generated from a fixed seed.

The first step, reading the ask into services, skills and urgency, is served by a small fine-tuned model (Qwen2.5 1.5B with a LoRA adapter on Veri), with Claude as the fallback and a keyword reader as the floor. The ask page shows how long it took ("Parsed in 240ms by ..."). Results: [scripts/train/EVAL.md](scripts/train/EVAL.md), model card: [scripts/train/MODEL_CARD.md](scripts/train/MODEL_CARD.md).

## Architecture

```
 browser                        Next.js 16 server (Vercel, Node runtime)                        Postgres + pgvector
 -------                        ----------------------------------------                        -------------------
 /ask/new  --create-->  ask lifecycle (src/lib/ask-state.ts, transitionAsk) ------------------>  asks, ask_events
 /ask/[id] --run----->  pipeline steps (src/lib/ask-pipeline.ts)
           <--poll---     1 understanding --> callModel(understand_ask)
                                                tier 1 fine-tune (Veri) -> tier 2 Claude Haiku -> keyword reader
                          confirm (the asker edits the reading; a document may answer it here)
                          2 retrieval     --> six paths, pgvector on a local embedding ------->  employees, docs, services
                          3 ranking       --> rankCandidates (code: weights, 4 guardrails)
                                              + availability engine (calendars, app clock)  -->  calendar_events
                                              + callModel(explain_ranking), fact checked
                          4 drafting      --> callModel(draft_ask), scrubbed and grounded  --->  ask_messages
 draft page --"I sent this"--> sent -> answered | stale -> next person
 /ramp, /insights        read models (k-anonymity 5 on insights)

 callModel (src/lib/model.ts) is the only way to a model: 6 checks (mode, approval, rate limit,
 user budget, global budget, key), then the tier chain; any refusal or failure serves a recorded
 or deterministic demo result. One usage_log row per call. Sentry spans wrap calls, retrieval, ranking.
```

Modes: **demo** (signed out, pending accounts, the shared guided demo account) never reaches a model provider; **live** is for approved accounts only. The rules for both live in `CLAUDE.md`; logging and debugging in `DEBUGGING.md`.

## Run locally

```bash
pnpm install
cp .env.example .env.local      # set AUTH_SECRET (openssl rand -base64 32); the rest is optional
pnpm db:up                      # Postgres 17 with pgvector in docker, host port 5433
pnpm db:reset                   # drop, migrate and load the synthetic company (local only)
pnpm dev                        # http://localhost:3000
pnpm preflight                  # pass/warn/fail table: database, seed, fixtures, keys, budgets, fine-tune
```

The first account you sign up becomes the admin (approved, so it gets live mode when `ANTHROPIC_API_KEY` is set). Press Ctrl+` in the app for the debug log.

## Environment variables

| Variable | Required | What it does |
|---|---|---|
| `DATABASE_URL` | yes | Postgres with pgvector. Local: the docker URL in `.env.example`. Vercel: the Neon pooled URL (prepared statements are turned off for pooled hosts). |
| `AUTH_SECRET` | yes | Signs the session cookie. 32+ characters. |
| `ADMIN_EMAILS` | no | Comma separated emails made admin (and approved) at signup. Without it only the first account is admin. |
| `ANTHROPIC_API_KEY` | no | Live Claude calls for approved accounts. Without it everyone gets demo mode, which is complete. |
| `USER_DAILY_TOKEN_BUDGET` | no | Live tokens per account per UTC day (default 50000). |
| `GLOBAL_DAILY_TOKEN_BUDGET` | no | Live tokens for the whole app per UTC day (default 500000). Owner scripts do not count. |
| `VERI_API_KEY` | no | Veri key for the fine-tuned tier. |
| `VERI_UNDERSTAND_DEPLOYMENT` | no | Veri deployment id serving the adapter. Without it (or the key) the fine-tune tier is skipped. |
| `VERI_UNDERSTAND_MODEL` | no | Adapter alias on that deployment (default `altostratus-understand`). |
| `VERI_TIMEOUT_MS` | no | Fine-tune timeout before Claude takes over (default 2500). |
| `SENTRY_DSN` | no | Server errors and tracing. |
| `NEXT_PUBLIC_SENTRY_DSN` | no | Browser errors, tracing and session replay (all text and inputs masked). |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | no | Source map upload at build time. |
| `LOG_LEVEL` | no | `trace`, `debug`, `info`, `warn`, `error` (default trace in development, debug in production). |
| `ASK_STEP_MIN_MS` | no | Minimum time each status line stays on screen while an ask runs (default 700). |
| `ALLOW_DB_RESET` | no | Lets `pnpm db:reset` run against a non-local host. Never set it on Vercel. |

With only `DATABASE_URL` and `AUTH_SECRET`, the app runs entirely in demo mode, including the guided demo.

## Sponsor integrations

Four optional integrations, each behind its own flag (`src/lib/flags.ts`). With every flag off the app behaves exactly as before. Every check is logged (`grep "flag "`), and so is every call (`grep "\[model.stepfun\]"`, `"creao run"`, `"\[photon.api\]"`, `"\[phone\]"`, `"\[agent.api\]"`). `/privacy#optional-integrations` says what data each one touches.

### Which model does what

| Step | Model or service | Where |
|---|---|---|
| Read the ask into services, skills, urgency, sensitive spans | Fine-tuned Qwen2.5 1.5B + LoRA on Veri, falling back to Claude Haiku 5.5 | `understand_ask` |
| Resolve company jargon before retrieval | CREAO glossary agent (`FEATURE_CREAO_GLOSSARY`) | `resolve_jargon` |
| Read an attached screenshot into the same structure as the text | **StepFun step-5-preview** (`FEATURE_STEPFUN_VISION`) | `read_screenshot` |
| Retrieval, ranking, availability | No model: pgvector with a local hashed embedding, `rank.ts`, `availability.ts` | |
| Reasons on the shortlist, the draft, the ramp plan | Claude Haiku 5.5 | `explain_ranking`, `draft_ask`, `ramp_plan` |

All of them go through `callModel` (`src/lib/model.ts`): same 6 gate checks, usage row, demo fixture and recorded fixtures. Demo mode never calls a provider.

### Fetch.ai (ASI:One): `FEATURE_FETCH_AGENT`

- **Agent address:** `agent1q2lddust7jzpstppag2mhn9h5c5m04vngtyhcegg9gq2q239n2d0qe84tj8`
- uAgent in `agents/fetch/` (README there), Agent Chat Protocol 0.3.0, mailbox, manifest published. It calls the app, it does not reimplement it: `POST /api/agent/asks`, `POST /api/asks/[askId]/run` (existing), `GET /api/agent/asks/[askId]`, `.../confirm`, `.../choose`, `.../sent`, `.../retry`. Each route calls the same function the web UI does.
- Whole workflow in the chat: describe the problem, then a review or detail card (understanding, company terms, a doc that may answer it), then a carousel card with the shortlist and a reason per person, then pick a person, then a review card with the draft, then "I sent it".
- Reliability: 3 attempts with backoff on network errors, 429 and 5xx (honours Retry-After); waits out a held run lease; resubmits a failed step once; re-creates an ask a demo reset deleted; re-reads state on a conflict; a plain message with the error code otherwise. `agents/fetch/test_flow.py` plays the flow and the recovery paths.
- Auth: bearer `AGENT_API_TOKEN`; each ASI:One sender acts as its own signed-out visitor (demo mode), isolated from every other sender.
- Requirements: registered on Agentverse (mailbox), Chat Protocol, usable from ASI:One, full workflow in the chat, Interactive Cards, error recovery.

### CREAO: `FEATURE_CREAO_GLOSSARY`

- **Agent id:** _fill in from agent.creao.ai_ &nbsp; **Run share link:** _fill in_
- The glossary agent (`agents/creao/glossary-agent.md`) reads the ask against Ferndale's jargon table (`src/lib/glossary.ts`: "the till" means billing-service, "Paperboy" means invoice-worker, "WH secret", "DLQ", ...). It runs before retrieval. Its hits add services and skills to the understanding and their meanings to the search text. The agent may only answer with glossary ids, and each phrase must appear in the ask.
- Why it is core: "The till double charged a shipper after the WH secret rotated" names no service, and the text reader finds none. The glossary supplies billing-service, vault-config and the Stripe skills, and that is what makes the right owners show up. Without the agent, jargon-only asks route by wording alone.
- Live: CREAO API Trigger (`src/lib/model-creao.ts`), run then poll, 30s timeout. Demo: exact whole-word matches in our code.

### Photon: `FEATURE_PHOTON`

- `/account#phone`: enter your own number, get a code, text `LINK <code>` from that number to the agent's number. This is inbound only: the app never texts first.
- On a ready draft, "Text it to my phone" sends the draft to that conversation. Send it from your real messaging app, then reply `SENT`. That runs the same `markSent` as "I sent this" (the recipient's load moves). `STOP` unlinks.
- Never messages anyone else: the single send function (`replyTo` in `src/lib/phone.ts`) only accepts a linked row, and unknown senders, wrong codes and group chats are logged and never answered.
- Inbound is polled through `POST /api/photon/sync`: by the page while it waits, or by a scheduler with `PHOTON_SYNC_SECRET`.

### StepFun: `FEATURE_STEPFUN_VISION`

- The composer has an optional screenshot (PNG, JPEG or WebP under 1.5 MB, scaled in the browser), plus a "Use the sample screenshot" button.
- In the understanding step, `read_screenshot` calls **step-5-preview** at runtime. It returns exactly the text path's structure (services, skills, error signatures as artifacts, sensitive spans), which is unioned into the understanding. The confirm screen shows what it read. Text that looks like a secret never becomes an artifact. The image is deleted once read.
- Demo mode reads only the committed sample (`public/samples/billing-webhook-error.png`, `fixtures/demo/read_screenshot.json`).

## Deploy (Vercel)

1. Create a Neon Postgres database (Vercel Marketplace) and copy its pooled URL.
2. Locally, against that URL once: `DATABASE_URL=<neon url> pnpm db:migrate`, then `DATABASE_URL=<neon url> pnpm seed`.
3. In the Vercel project set `DATABASE_URL`, `AUTH_SECRET`, `ADMIN_EMAILS`, and any optional keys above. `vercel.json` sets the pnpm install and build; nothing else is needed.
4. Deploy, sign up with an `ADMIN_EMAILS` address, then run `pnpm preflight` with the production `DATABASE_URL` to check the seed and fixtures.

## Reset the demo

Every page shows a **Reset demo** button in the demo banner (for the demo account, signed-out visitors and admins). It deletes every demo and signed-out ask, restores the colleagues' ask load counters, and rebuilds the guided demo at the pinned clock in about half a second. Press it between judges. `pnpm demo:check` does the same reset from the command line and checks the story still holds.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` / `build` / `start` | Next.js |
| `pnpm check` | typecheck plus the UI rules checker (`scripts/check-rules.mjs`) |
| `pnpm preflight` | run before judging: one pass/fail table |
| `pnpm db:up` / `db:down` | start or stop local Postgres |
| `pnpm db:generate` / `db:migrate` / `db:studio` | Drizzle |
| `pnpm db:reset [seed]` | drop, migrate, seed (refuses non-local hosts without `ALLOW_DB_RESET=1`) |
| `pnpm seed [seed]` | reload the synthetic company; accounts are kept |
| `pnpm fixture:generate [seed] [--no-model]` | rebuild `fixtures/company.json` |
| `pnpm fixtures:record` | record live answers for demo mode (needs keys; `--dry-run`, `--only-missing`) |
| `pnpm seed:check`, `retrieve:check`, `ask:check`, `rank:check`, `draft:check`, `ramp:check`, `demo:check` | offline invariants per stage |
| `pnpm train:generate`, `train:prep`, `train:eval` | the fine-tune data, split and eval (`scripts/train/README.md`) |

## More

- `CLAUDE.md`: rules, architecture and the state of the build.
- `DEBUGGING.md`: log format, error codes, and how to debug from a pasted log.
- `SENTRY_LOG.md`: what error monitoring caught.
- `/privacy` and `/terms` in the app.
