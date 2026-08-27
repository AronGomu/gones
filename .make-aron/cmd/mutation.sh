#!/usr/bin/env bash
set -uo pipefail
. .make-aron/cmd/lib.sh

# G5 reads one mutation-testing-elements report at reports/mutation/mutation.json.
# Each stack produces its own; this merges them by union of the "files" map.
#
# Scope is the diff's line ranges, not the changed files: handed a bare path both
# engines mutate the whole file and crap.py scores every mutant in the report, so
# a small edit to a large service would be graded on code the ticket never
# touched. diff-ranges.py turns the hunks into each engine's range syntax.
#
# A leg that cannot run must never look like a clean scan. Any engine failure
# exits non-zero without writing the report, so run.sh reports "mutation report
# not produced" (exit 2, cannot run) instead of a false pass.
OUT=reports/mutation/mutation.json
mkdir -p reports/mutation
rm -f "$OUT" reports/mutation/mutation-js.json reports/mutation/mutation-net-*.json

node_scope="$(python3 .make-aron/cmd/diff-ranges.py "$BASE_REF" \
  --pattern '^(src|ops)/.*\.ts$' --format js \
  | grep -v '\.test\.ts:' \
  | grep -v '^src/app/api/generated/' \
  | paste -sd, -)"

if [ -n "$node_scope" ]; then
  echo "stryker --mutate $node_scope"
  npx stryker run .make-aron/stryker.config.json --mutate "$node_scope" || {
    echo "CANNOT RUN: StrykerJS failed" >&2; exit 1; }
fi

# Which test projects can kill a mutant in a given source project: the ones whose
# csproj references it. Gones.Api is reachable only from Gones.IntegrationTests —
# scoring it against Gones.UnitTests makes dotnet-stryker abort with "Could not
# find an assembly reference to a mutable assembly", which silently graded the
# whole backend at zero until 2026-08-27.
test_projects_for() {
  local srcproj="$1" p
  for p in backend/tests/*/*.csproj; do
    # ArchitectureTests asserts structure, never behaviour: it kills nothing and
    # only slows the run down.
    case "$p" in *Gones.ArchitectureTests*) continue ;; esac
    grep -q "Include=\".*[\\\\/]$srcproj\.csproj\"" "$p" && echo "$p"
  done
}

net_failed=0
if backend_touched; then
  mapfile -t net_ranges < <(python3 .make-aron/cmd/diff-ranges.py "$BASE_REF" \
    --pattern '^backend/src/.*\.cs$' --format net)

  # Group the ranges by the source project that owns them.
  mapfile -t src_projects < <(printf '%s\n' "${net_ranges[@]}" \
    | sed -nE 's|^backend/src/([^/]+)/.*|\1|p' | sort -u)

  for srcproj in "${src_projects[@]}"; do
    [ -n "$srcproj" ] || continue
    mutate_args=()
    for entry in "${net_ranges[@]}"; do
      case "$entry" in backend/src/"$srcproj"/*) mutate_args+=(--mutate "$entry") ;; esac
    done
    [ ${#mutate_args[@]} -gt 0 ] || continue

    test_args=()
    while IFS= read -r tp; do
      [ -n "$tp" ] && test_args+=(--test-project "$tp")
    done < <(test_projects_for "$srcproj")

    if [ ${#test_args[@]} -eq 0 ]; then
      echo "CANNOT RUN: no behavioural test project references $srcproj — mutants in it cannot be graded" >&2
      net_failed=1
      continue
    fi

    outdir=".make-aron/.stryker-net/$srcproj"
    rm -rf "$outdir"
    dotnet-stryker \
      --solution backend/Gones.sln \
      "${test_args[@]}" \
      "${mutate_args[@]}" \
      --reporter json \
      --output "$outdir" || { echo "CANNOT RUN: dotnet-stryker failed for $srcproj" >&2; net_failed=1; continue; }

    found="$(find "$outdir" -name 'mutation-report.json' | head -1)"
    if [ -z "$found" ]; then
      echo "CANNOT RUN: dotnet-stryker produced no report for $srcproj" >&2
      net_failed=1
      continue
    fi
    cp "$found" "reports/mutation/mutation-net-$srcproj.json"
  done
fi

[ "$net_failed" -eq 0 ] || exit 1

python3 - "$OUT" reports/mutation/mutation-js.json reports/mutation/mutation-net-*.json <<'PY'
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
