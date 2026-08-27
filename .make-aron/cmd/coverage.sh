#!/usr/bin/env bash
set -uo pipefail
. .make-aron/cmd/lib.sh

# G3/G4 want one lcov file at coverage/lcov.info. The node run writes it; a
# backend diff appends coverlet's lcov records to the same file. lcov is a flat
# sequence of SF:/end_of_record blocks, so concatenation is a valid merge, and
# crap.py rewrites coverlet's absolute paths to repo-relative ones itself.
npx vitest run --coverage --coverage.reporter=lcov || exit 1

if backend_touched; then
  rm -rf .make-aron/.cov
  dotnet test backend/Gones.sln --configuration Release \
    --collect:"XPlat Code Coverage;Format=lcov" \
    --results-directory .make-aron/.cov || exit 1
  find .make-aron/.cov -name 'coverage.info' -print0 \
    | xargs -0 -r cat >> coverage/lcov.info
fi
