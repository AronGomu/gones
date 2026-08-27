#!/usr/bin/env bash
set -uo pipefail
. .make-aron/cmd/lib.sh

npm run lint || exit 1
if backend_touched; then
  # The .NET side has no separate linter: analyzers run as part of the build and
  # TreatWarningsAsErrors is set in Directory.Build.props, so a clean build is
  # the lint result. Covered by typecheck.sh; nothing extra to run here.
  :
fi
