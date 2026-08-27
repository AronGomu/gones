#!/usr/bin/env bash
set -uo pipefail
. .make-aron/cmd/lib.sh

# G5 reads one mutation-testing-elements report at reports/mutation/mutation.json.
# Each stack produces its own; this merges them by union of the "files" map.
#
# Scope is the diff's line ranges, not the changed files: handed a bare path both
# engines mutate the whole file, and crap.py scores every mutant in the report,
# so a small edit to a large service would be graded on code the ticket never
# touched. diff-ranges.py turns the hunks into each engine's range syntax.
OUT=reports/mutation/mutation.json
mkdir -p reports/mutation
rm -f "$OUT" reports/mutation/mutation-js.json reports/mutation/mutation-net.json

node_scope="$(python3 .make-aron/cmd/diff-ranges.py "$BASE_REF" \
  --pattern '^(src|ops)/.*\.ts$' --format js | grep -v '\.test\.ts:' | paste -sd, -)"

if [ -n "$node_scope" ]; then
  echo "stryker --mutate $node_scope"
  npx stryker run .make-aron/stryker.config.json --mutate "$node_scope" || true
fi

if backend_touched; then
  # Mutants are scored against Gones.UnitTests only. The 624-test integration
  # suite takes ~5 minutes per run, which per-mutant is not a budget any ticket
  # can pay; a survivor that only an integration test would have killed is a
  # missing unit test, which is the outcome this pipeline wants anyway.
  net_scope=()
  while IFS= read -r entry; do
    [ -n "$entry" ] && net_scope+=(--mutate "$entry")
  done < <(python3 .make-aron/cmd/diff-ranges.py "$BASE_REF" \
             --pattern '^backend/src/.*\.cs$' --format net)

  if [ ${#net_scope[@]} -gt 0 ]; then
    rm -rf .make-aron/.stryker-net
    dotnet-stryker \
      --solution backend/Gones.sln \
      --test-project backend/tests/Gones.UnitTests/Gones.UnitTests.csproj \
      "${net_scope[@]}" \
      --reporter json \
      --output .make-aron/.stryker-net || true
    found="$(find .make-aron/.stryker-net -name 'mutation-report.json' | head -1)"
    [ -n "$found" ] && cp "$found" reports/mutation/mutation-net.json
  fi
fi

python3 - "$OUT" reports/mutation/mutation-js.json reports/mutation/mutation-net.json <<'PY'
import json, os, sys
out, parts = sys.argv[1], sys.argv[2:]
merged = {"schemaVersion": "1.0", "thresholds": {"high": 100, "low": 100}, "files": {}}
for p in parts:
    if not os.path.exists(p):
        continue
    with open(p) as fh:
        rep = json.load(fh)
    merged["files"].update(rep.get("files") or {})
with open(out, "w") as fh:
    json.dump(merged, fh)
print(f"merged mutation report: {len(merged['files'])} file(s) -> {out}")
PY
