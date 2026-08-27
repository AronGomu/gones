#!/usr/bin/env bash
set -uo pipefail
. .make-aron/cmd/lib.sh

npm run typecheck || exit 1
if backend_touched; then
  dotnet build backend/Gones.sln --configuration Release --nologo || exit 1
fi
