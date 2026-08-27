#!/usr/bin/env bash
set -uo pipefail
. .make-aron/cmd/lib.sh

# The node suite (2033 tests, ~18s) always runs: ops/*.test.ts assert on repo
# files including docs and AGENT.md, so even a doc-only diff can turn it red.
npx vitest run || exit 1

# The .NET suite is 624 integration tests against real containers, ~5 minutes.
# Nothing in src/ or ops/ is compiled into it, so it only runs on backend diffs.
if backend_touched; then
  npm run backend:test || exit 1
fi
