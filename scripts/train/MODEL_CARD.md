# Model card: altostratus-understand

**What it does:** reads a new hire's free-text ask into the strict understand_ask JSON (`src/lib/understanding.ts`): services and skills from the company catalog, artifacts (repos, errors, dashboards, tickets, links), kind of help, urgency, and sensitive spans to keep out of the draft. Tier 1 of `understand_ask` in `callModel`; Claude Haiku 5.5 answers on error or timeout (`VERI_TIMEOUT_MS`, 2500), then the keyword reader.

**Base:** Qwen/Qwen2.5-1.5B-Instruct. **Method:** LoRA SFT on Veri (rank 16, alpha 32, lr 2e-4, 2 epochs, seq 2048, one L4; job `de52222eb02f`, $1.45). **Prompt:** `compact-v1` (short instruction plus the catalog; the rules were learned). **Serving:** Veri multi-adapter fleet on one A10G (`76460af8eea2`, $1.31/h, scales to zero after 30 idle minutes); an older L4 fleet (`2f650041aa38`) was used for the L4 row.

**Data:** 3,294 synthetic examples (3,699 generated, 405 rejected by validation), written backwards from known labels: `spec.ts` samples the correct answer from the seeded company, Claude Haiku 5.5 writes the messy question ($0.80). Six categories: clear, vague, no company vocabulary, two problems mixed, contains something sensitive, second language. Split: 2,891 train, 300 test (50 per category), 103 held-out-service examples about 4 services no training example mentions. All committed in `data/understand/`.

## Results

Full table: [EVAL.md](./EVAL.md). Test set, 300 examples:

| System | Entity F1 | Sensitive recall | p50 | p95 | Cost / 1k |
|---|---|---|---|---|---|
| Keyword fallback | 82.7% | 74.1% | 1ms | 1ms | $0 |
| Claude Haiku 5.5 (production before) | 78.2% | 98.8% | 1.27s | 1.78s | $0.14 |
| Claude Sonnet 5.5 (frontier) | 77.5% | 100.0% | 1.70s | 2.37s | $2.76 |
| **Fine-tune, A10G** | **90.9%** | **100.0%** | **0.90s** | **1.35s** | $0.34 to $0.42 |
| Fine-tune, L4 | 90.9% | 92.6% | 1.33s | 2.18s | $0.41 |

The A10G row was written while that run was still going (192 of 403 calls); `pnpm train:eval --report-only` refreshes it. Its cost was priced at the L4 rate while it ran; at the A10G rate it is about $0.42 per 1k.

## Where it wins and where it loses

- **Wins on quality.** It beats both Claude models on entity F1 by about 13 points (skills and artifacts most), and on held-out services (88.6% on the L4 run).
- **Beats Sonnet on everything:** quality, latency and cost.
- **Beats Haiku on latency only on the faster GPU.** On an L4 it was slower than Haiku at p95 (2.18s against 1.78s). Decoding is memory-bandwidth bound (about 14ms per token on an L4), and the Veri gateway adds about 0.2 to 0.3s to every call.
- **Loses to Haiku on cost per call** at concurrency 1 ($0.34 to $0.42 against $0.14). This is an upper bound: a busy fleet batches calls, and an idle one costs nothing after it scales to zero. A fleet kept awake for a judging day costs $1.31 an hour whatever the traffic.
- **The keyword reader is a strong floor.** It beats both Claude models on entity F1 (82.7%), because exact catalog names carry the services, but it misses sensitive spans (74.1% recall) and the kind of help (57.3%).
- **Base model prompted:** not yet measured on the new fleet (an earlier run failed on the model name, fixed in `serve.sh`).
- **Caveats:** the test text is synthetic and written by a Claude model from the same labels, and so are the training examples. Real new-hire phrasing will differ. Latency was measured from one laptop.

## Intended use and limits

For reading asks inside Altostratus against the Ferndale catalog it was trained with. A different catalog needs regenerated data. It never sees the confidential note. Its sensitive-span output decides what the draft leaves out, so a miss there can reach a colleague's message, although the draft step re-checks before showing it.
