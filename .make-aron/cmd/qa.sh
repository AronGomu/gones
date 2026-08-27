#!/usr/bin/env bash
set -uo pipefail
. .make-aron/cmd/lib.sh

# G9 is "does it build", per the user decision of 2026-08-27. The repo's running-
# system smokes (npm run smoke, e2e:ci) need the compose stack up and e2e:ci
# destroys the DB volumes on teardown, so they are out for a 39-commit run.
npm run build || exit 1
npm run backend:build || exit 1
