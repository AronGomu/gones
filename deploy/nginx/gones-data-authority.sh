#!/bin/sh
# Container-start data-authority gate (C44).
#
# The third implementation of the ADR 0019 rules, next to `src/app/config/data-authority.ts` (runtime)
# and `scripts/check-frontend-data-authority.mjs` (build). `ops/frontend-data-authority.test.ts` feeds
# the same declaration matrix to all three and fails on any drift, so they cannot diverge.
#
# Reads GONES_DATA_MODE, GONES_API_BASE_URL, GONES_AUTH_V1, GONES_ADMIN_V1 from the environment.
# Exit 0: the declaration is coherent. Exit 2: it is not, and the failure code is printed on stdout.
set -eu

mode="${GONES_DATA_MODE-}"
api="${GONES_API_BASE_URL-}"
auth="${GONES_AUTH_V1-false}"
admin="${GONES_ADMIN_V1-false}"

# Same normalization as the runtime resolver: trim whitespace, then drop trailing slashes.
api="$(printf '%s' "$api" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's:/*$::')"

fail() {
  printf '%s\n' "$1"
  exit 2
}

case "$mode" in
  legacy-browser | server) ;;
  *) fail dataModeUnknown ;;
esac

if [ "$mode" = "server" ]; then
  [ -n "$api" ] || fail serverModeApiBaseUrlMissing
  if [ "$admin" = "true" ] && [ "$auth" != "true" ]; then fail serverModeAdminRequiresAuth; fi
else
  [ -z "$api" ] || fail legacyModeApiBaseUrlForbidden
  if [ "$auth" = "true" ] || [ "$admin" = "true" ]; then fail legacyModeCapabilityForbidden; fi
fi

exit 0
