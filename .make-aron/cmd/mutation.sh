#!/usr/bin/env bash
set -uo pipefail
. .make-aron/cmd/lib.sh

# G5 reads one mutation-testing-elements report at reports/mutation/mutation.json.
# Each stack produces its own; this merges them by union of the "files" map.
OUT=reports/mutation/mutation.json
mkdir -p reports/mutation
rm -f "$OUT" reports/mutation/mutation-js.json reports/mutation/mutation-net.json

node_touched() { changed_files | grep -qE '^(src|ops)/.*\.ts$'; }

if node_touched; then
  npx stryker run .make-aron/stryker.config.json --since "$BASE_REF" || true
fi

if backend_touched; then
  # Mutants are scored against Gones.UnitTests only. The 624-test integration
  # suite takes ~5 minutes per run, which per-mutant is not a budget any ticket
  # can pay; a survivor that only an integration test would have killed is a
  # missing unit test, which is the outcome this pipeline wants anyway.
  rm -rf .make-aron/.stryker-net
  dotnet-stryker \
    --solution backend/Gones.sln \
    --test-project backend/tests/Gones.UnitTests/Gones.UnitTests.csproj \
    --since:"$BASE_REF" \
    --reporter json \
    --output .make-aron/.stryker-net || true
  found="$(find .make-aron/.stryker-net -name 'mutation-report.json' | head -1)"
  [ -n "$found" ] && cp "$found" reports/mutation/mutation-net.json
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
