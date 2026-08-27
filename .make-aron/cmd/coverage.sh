#!/usr/bin/env bash
set -uo pipefail
. .make-aron/cmd/lib.sh

# G3/G4 want one lcov file at coverage/lcov.info. The node run writes it; a
# backend diff appends coverlet's records to the same file, after folding the
# per-project reports into one record per source file: all three .NET projects
# load the same assemblies, and crap.py's parser is last-write-wins, so a plain
# concatenation lets ArchitectureTests' zero record erase the real coverage.
# crap.py rewrites coverlet's absolute paths to repo-relative ones itself.
npx vitest run --coverage --coverage.reporter=lcov || exit 1

if backend_touched; then
  rm -rf .make-aron/.cov
  dotnet test backend/Gones.sln --configuration Release \
    --collect:"XPlat Code Coverage;Format=lcov" \
    --results-directory .make-aron/.cov || exit 1
  mapfile -t reports < <(find .make-aron/.cov -name 'coverage.info')
  if [ "${#reports[@]}" -gt 0 ]; then
    python3 .make-aron/cmd/merge-lcov.py .make-aron/.cov/merged.info "${reports[@]}" || exit 1
    cat .make-aron/.cov/merged.info >> coverage/lcov.info
  fi
fi
