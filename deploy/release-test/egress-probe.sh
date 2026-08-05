#!/bin/sh
# Proves the application network really is unroutable (C41).
#
# Exit 0 means "no egress" — every attempt to leave the host failed. Exit 1 means a route exists and
# the rehearsal must fail: a stack that can reach the internet is not the isolated tier we claim.
set -u

if ip route show default 2>/dev/null | grep -q default; then
    echo "egress-probe: a default route exists on the application network" >&2
    exit 1
fi

for target in 1.1.1.1:53 8.8.8.8:53 93.184.216.34:80; do
    host="${target%%:*}"
    port="${target##*:}"
    if nc -z -w 2 "$host" "$port" 2>/dev/null; then
        echo "egress-probe: reached $target from the application network" >&2
        exit 1
    fi
done

echo "egress-probe: no default route and no outbound connection succeeded"
