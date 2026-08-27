#!/usr/bin/env bash
set -uo pipefail
. .make-aron/cmd/lib.sh

npm run build || exit 1
if backend_touched; then
  npm run backend:build || exit 1
fi
