# Sentry log

Real bugs found through error monitoring, with what changed. Only bugs that Sentry itself surfaced go in the first table; the second keeps bugs found the same week by the app's own logs, so the two can be compared.

## Setup

- `@sentry/nextjs` 10.76.0. Server: `src/instrumentation.ts` (errors through `onRequestError`, tracing at `SENTRY_TRACES_SAMPLE_RATE`, default 1). Browser: `src/instrumentation-client.ts` (errors, navigation tracing, session replay with `maskAllText`, `maskAllInputs` and `blockAllMedia`, so a replay never shows an ask, a draft or a confidential note).
- Spans (`src/lib/observe.ts`, on `@sentry/core` so scripts can load it): `model.<purpose>` (op `ai.model`, tagged with source, tier, model and ms), `ask.step.<state>` (op `ask.step`) for every pipeline step, `ask.retrieve` (op `ai.retrieval`), `ask.rank` (op `ai.ranking`).
- Handled 5xx failures from `withRoute` and `withAction` are reported with tags `req_id`, `error_code` and `where`, so a Sentry issue matches a log line by request id. 4xx refusals (validation, rate limits, auth) are not reported.
- `beforeSend` (`scrubEvent`) drops request bodies, cookies and auth headers and runs messages through the log redaction.
- Off unless `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are set; `pnpm preflight` says which.

## Caught by Sentry

| Date | Issue | Cause | What changed |
|---|---|---|---|
| | None yet: no DSN was configured when monitoring was added (2026-10-18). Add rows as issues arrive. | | |

## Found by the app's own logs (for comparison)

| Date | What the log showed | Cause | What changed |
|---|---|---|---|
| 2026-10-18 | `gate 4/5 global budget not exhausted: FAIL (3131576 of 500000 tokens today)` on every eval call, and the live app in demo mode for the rest of the UTC day | Owner scripts (the 300-example Haiku and Sonnet eval) counted toward the app's global token budget | `getBudgetState` ignores rows without a user (only owner scripts are live without one); scripts cap themselves with `--max-usd` |
| 2026-10-18 | `train.eval finetune: finished, 403 invalid of 403` with `valid 0.0%` | The eval wrote gate refusals as invalid predictions, so a budget problem looked like a broken model | A gate refusal stops the run and writes nothing; only provider errors count against a system |
| 2026-10-18 | Deployment `total_requests 0` and an empty adapter list after training finished | `serve.sh` created the fleet but the adapter was never saved and attached | Adapter saved (`eff3421f2950`) and attached; `serve.sh` takes `GPU=` and prints `VERI_BASE_MODEL` |
| 2026-10-18 | `veri answered 400: unknown model 'Qwen/Qwen2.5-1.5B-Instruct' for this multi_adapter deployment` | On a multi-adapter fleet the base model answers to the deployment's name, not the Hugging Face id | `VERI_BASE_MODEL` is the fleet name; `serve.sh` prints it |
