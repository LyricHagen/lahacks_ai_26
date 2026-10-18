# understand_ask fine-tune

A small open model (Qwen2.5 1.5B Instruct with a LoRA adapter, trained and served on [Veri](https://docs.veri.studio)) that reads a new hire's ask into the strict understand_ask JSON (src/lib/understanding.ts). It is the first tier of the `understand_ask` purpose in `callModel`; Claude Haiku 5.5 answers when it fails or times out, and the deterministic keyword reader answers when both do. Results: [EVAL.md](./EVAL.md). Model card: [MODEL_CARD.md](./MODEL_CARD.md).

Why this task and not drafting: understanding runs on every ask, has an exact schema that can be scored without a judge, and its latency is on screen ("Parsed in 240ms ..."). Drafting would need an LLM judge and its latency hides behind the shortlist.

## Files

| File | What it is |
|---|---|
| `spec.ts` | Label-first sampler: draws the correct answer (services, skills, artifacts, kind of help, urgency, sensitive items) from the seeded company. Six categories, four held-out services. |
| `generate.ts` | `pnpm train:generate`: Claude Haiku 5.5 (purpose `train_phrasing`, through callModel) writes the messy question for each label; every example is validated (artifacts and sensitive spans copied exactly, no unlisted names). Resumable. |
| `prep.ts` | `pnpm train:prep`: stratified split and the Veri training file. |
| `train.toml` | The Veri job: LoRA rank 16, 2 epochs, one L4. |
| `launch.sh` | Checks login and balance, uploads the data, prints the estimate, submits only with `--yes`. |
| `serve.sh` | Creates the multi-adapter deployment of the base model and attaches the adapter. |
| `eval.ts`, `score.ts` | `pnpm train:eval`: the five-system comparison, written to `EVAL.md` and `data/understand/eval/results.json` (rendered on `/admin/models`). |

Committed data (never needs regenerating): `data/understand/generated.jsonl` (every accepted example), `train.jsonl`, `test.jsonl` (300: 50 per category), `heldout_services.jsonl`, `veri_train.jsonl`, `generation.json` (counts, rejections, cost), and the eval predictions in `data/understand/eval/`.

## Rerun from scratch

```bash
uv tool install --upgrade 'veri-sdk[mcp]'      # the veri CLI
# VERI_API_KEY and ANTHROPIC_API_KEY in .env.local

pnpm train:generate --max-usd 1.5              # optional: the committed file is already complete
pnpm train:prep                                # deterministic split
scripts/train/launch.sh                        # balance, upload, estimate; nothing submitted
scripts/train/launch.sh --yes                  # submit (about 40 minutes on one L4)
veri jobs logs <job_id> -f
scripts/train/serve.sh <job_id>                # save the adapter, create the fleet, attach it; prints the env vars
pnpm train:eval                                # all five systems; resumable, --max-usd caps Anthropic spend
```

Then set in `.env.local` (and on Vercel):

```
VERI_UNDERSTAND_DEPLOYMENT=<deployment id from serve.sh>
VERI_UNDERSTAND_MODEL=altostratus-understand
VERI_TIMEOUT_MS=2500
```

Without them the fine-tune tier is skipped (logged `skipped: tier 1/2 finetune ... VERI_UNDERSTAND_DEPLOYMENT is not set`) and Haiku answers as before.

## Costs

- Data: about $0.80 of Claude Haiku 5.5 for ~3,700 generations (`data/understand/generation.json` has the exact figure).
- Training: one L4 at $1.05 per hour; `launch.sh` prints Veri's estimate before submitting.
- Serving: the fleet runs on one L4 at $1.05 per hour while awake, `min_replicas 0`, so it scales to zero after the idle window (`scale_to_zero_window_seconds`, 1800 in `serve.sh`). A cold fleet answers the first request with 503 while it boots; that call falls to Haiku, and the next ones hit the warm fine-tune. Wake it before a demo: `veri deployments wake <id>`.
- Eval: about $2 of Claude Sonnet 5.5 and $0.10 of Haiku for 410 asks, prompt caching on.

## Logs

```
grep "tier "            every tier decision: chain, skips, failures with code and time, who served
grep "parse "           the "Parsed in Xms by ..." line shown on the ask page
grep "train.eval"       eval progress and the final per-system line
```
