#!/usr/bin/env bash
# scripts/train/serve.sh <job_id> [deployment_id]      (GPU=A10G-24GB by default; GPU=L4-24GB for the cheaper, slower card)
#
# Serves the LoRA adapter from a completed training job on Veri:
#   1. saves the job as a library model (artifact adapter)
#   2. creates a multi-adapter deployment of the base model on one GPU (min 0 replicas, so it
#      scales to zero when idle and stops billing), unless a deployment id is given
#   3. attaches the adapter under the alias altostratus-understand
# Prints the env vars for .env.local. On a multi-adapter fleet the base model answers to the
# deployment's name (the eval's "base prompted" row, VERI_BASE_MODEL); the alias answers with the adapter.
# Decoding is memory-bandwidth bound: an L4 decodes about 14ms per token, an A10G about twice as fast.
set -euo pipefail
cd "$(dirname "$0")/../.."
JOB="${1:?usage: serve.sh <job_id> [deployment_id]}"
DEP="${2:-}"
export VERI_API_KEY="${VERI_API_KEY:-$(grep '^VERI_API_KEY=' .env.local | cut -d= -f2-)}"
API=https://api.veri.studio
BASE=Qwen/Qwen2.5-1.5B-Instruct
ALIAS=altostratus-understand
GPU="${GPU:-A10G-24GB}"
NAME="$ALIAS-$(echo "$GPU" | cut -d- -f1 | tr A-Z a-z)"
auth=(-H "Authorization: Bearer $VERI_API_KEY" -H "Content-Type: application/json")

echo "== save adapter from job $JOB"
MODEL_ID=$(veri models save "$JOB" --name "$ALIAS-$JOB" --artifact adapter --format json | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
echo "model $MODEL_ID"

if [[ -z "$DEP" ]]; then
  echo "== create multi-adapter deployment of $BASE"
  DEP=$(curl -sS "${auth[@]}" -X POST "$API/v1/deployments" -d "{\"model\":\"$BASE\",\"source\":\"huggingface\",\"name\":\"$NAME\",\"gpu\":{\"gpu_type\":\"$GPU\",\"gpu_count\":1},\"serving_mode\":\"multi_adapter\",\"min_replicas\":0,\"max_replicas\":1,\"scale_to_zero_window_seconds\":1800,\"max_lora_rank\":16}" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["id"]) if "id" in d else sys.exit("create failed: %s" % d)')
fi
echo "deployment $DEP"

echo "== wait for serving"
for i in $(seq 1 90); do
  S=$(curl -sS "${auth[@]}" "$API/v1/deployments/$DEP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("status"))')
  echo "  $S"
  [[ "$S" == "serving" ]] && break
  [[ "$S" == "failed" || "$S" == "stopped" ]] && { echo "deployment $S"; exit 1; }
  sleep 20
done

echo "== attach adapter as $ALIAS"
curl -sS "${auth[@]}" -X POST "$API/v1/deployments/$DEP/adapters" -d "{\"serve_name\":\"$ALIAS\",\"model_id\":\"$MODEL_ID\"}"
echo
echo
echo "Add to .env.local:"
echo "VERI_UNDERSTAND_DEPLOYMENT=$DEP"
echo "VERI_UNDERSTAND_MODEL=$ALIAS"
echo "VERI_BASE_MODEL=$NAME"
