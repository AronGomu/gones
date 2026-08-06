#!/bin/sh
# Runtime configuration injection for the Gones single-page application artifact (C44).
#
# The release image is one immutable artifact that any host can serve on any origin: the API base
# URL, the data mode and the capability flags are injected here, at container start, not baked at
# build time. The build-time values survive only as the defaults of these variables.
#
# The root filesystem is read-only, so everything rendered here lands in a tmpfs:
#   /tmp/gones-nginx/default.conf   the server block (included by /etc/nginx/conf.d/default.conf)
#   /tmp/gones-www/runtime-config.json  the declaration the application reads before it bootstraps
set -eu

: "${GONES_DATA_MODE:=legacy-browser}"
: "${GONES_API_BASE_URL:=}"
: "${GONES_AUTH_V1:=false}"
: "${GONES_ADMIN_V1:=false}"
export GONES_DATA_MODE GONES_API_BASE_URL GONES_AUTH_V1 GONES_ADMIN_V1

# Fail closed before serving a single byte: an incoherent declaration is a configuration defect, and
# a static file server that "works anyway" would silently hand the browser the wrong data authority.
if ! failure="$(/etc/nginx/gones/gones-data-authority.sh)"; then
  echo "gones: refusing to serve an unsatisfiable data authority: ${failure} (dataMode=${GONES_DATA_MODE}, apiBaseUrl='${GONES_API_BASE_URL}', authV1=${GONES_AUTH_V1}, adminV1=${GONES_ADMIN_V1})" >&2
  exit 1
fi

boolean() {
  if [ "$1" = "true" ]; then printf 'true'; else printf 'false'; fi
}

mkdir -p /tmp/gones-nginx /tmp/gones-www

# Only this one variable is substituted, so nginx's own $variables survive untouched.
GONES_API_ORIGIN="${GONES_API_BASE_URL}"
export GONES_API_ORIGIN
envsubst '${GONES_API_ORIGIN}' < /etc/nginx/gones/default.conf.template > /tmp/gones-nginx/default.conf

printf '{"dataMode":"%s","apiBaseUrl":"%s","features":{"authV1":%s,"adminV1":%s}}\n' \
  "${GONES_DATA_MODE}" "${GONES_API_BASE_URL}" "$(boolean "${GONES_AUTH_V1}")" "$(boolean "${GONES_ADMIN_V1}")" \
  > /tmp/gones-www/runtime-config.json
chmod 0644 /tmp/gones-www/runtime-config.json /tmp/gones-nginx/default.conf

echo "gones: serving dataMode=${GONES_DATA_MODE} apiBaseUrl='${GONES_API_BASE_URL}' authV1=${GONES_AUTH_V1} adminV1=${GONES_ADMIN_V1}"
