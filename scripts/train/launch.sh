#!/usr/bin/env bash
# scripts/train/launch.sh [--yes]
#
# 1. checks the Veri login and prints the credit balance
# 2. uploads data/understand/veri_train.jsonl as dataset "altostratus-understand-train" (once)
# 3. prints the cost estimate for scripts/train/train.toml
# 4. submits the job ONLY with --yes, then prints the job id and how to follow it
#
# Needs: the veri CLI (uv tool install 'veri-sdk[mcp]'), VERI_API_KEY in .env.local.
set -euo pipefail
cd "$(dirname "$0")/../.."
export VERI_API_KEY="${VERI_API_KEY:-$(grep '^VERI_API_KEY=' .env.local | cut -d= -f2-)}"
CONFIG=scripts/train/train.toml
DATA=data/understand/veri_train.jsonl
NAME=altostratus-understand-train

echo "== account"
veri whoami --format json | python3 -c 'import sys,json; d=json.load(sys.stdin); print("user", d["email"], "balance $%.2f" % d["balance_usd"])'

echo "== dataset"
# Uploads are capped near 1 MB and every row carries the ~1,100 token catalog (17 MB in all), so
# the rows go into an append-only dataset stream in chunks; the job trains on its latest snapshot.
veri datasets check "$DATA"
if veri datasets list --format json | python3 -c "import sys,json; d=json.load(sys.stdin); rows=d.get('data',d) if isinstance(d,dict) else d; sys.exit(0 if any(r.get('name')=='$NAME' for r in rows) else 1)"; then
  echo "dataset $NAME already exists (delete it to re-upload: veri datasets delete $NAME)"
else
  veri datasets create "$NAME" --format completion
  TMP=$(mktemp -d)
  split -l 120 "$DATA" "$TMP/chunk_"
  for f in "$TMP"/chunk_*; do veri datasets append "$NAME" "$f" --quiet; done
  rm -rf "$TMP"
  veri datasets snapshot "$NAME" --note "understand-v1 train split"
fi

echo "== estimate"
veri jobs estimate "$CONFIG"

if [[ "${1:-}" != "--yes" ]]; then
  echo "Not submitted. Re-run with --yes to start the job."
  exit 0
fi
echo "== submit"
veri jobs create "$CONFIG" --format json | tee /dev/stderr | python3 -c 'import sys,json; d=json.load(sys.stdin); print("\njob", d["id"], "status", d.get("status")); print("follow: veri jobs logs", d["id"], "-f")'
