#!/bin/sh
# Release-rehearsal bootstrap (C41). Creates everything the stack treats as injected-by-the-host:
# a private CA, one server certificate per TLS endpoint, and every secret as a mounted file.
#
# All of it is generated here and thrown away with the volumes, so the repository never carries a
# credential, and the rehearsal never depends on one.
set -eu

certs=/certs
secrets=/secrets

random_hex() { od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }

if [ ! -f "$certs/ca.pem" ]; then
    openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 30 \
        -keyout "$certs/ca.key" -out "$certs/ca.pem" \
        -subj "/CN=Gones Release Test CA" >/dev/null 2>&1

    for host in tls-proxy fake-identity fake-brevo; do
        printf 'subjectAltName=DNS:%s,DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' "$host" > "/tmp/$host.ext"
        openssl req -newkey rsa:2048 -sha256 -nodes \
            -keyout "$certs/$host.key" -out "/tmp/$host.csr" -subj "/CN=$host" >/dev/null 2>&1
        openssl x509 -req -in "/tmp/$host.csr" -CA "$certs/ca.pem" -CAkey "$certs/ca.key" \
            -CAcreateserial -days 30 -sha256 -extfile "/tmp/$host.ext" \
            -out "$certs/$host.pem" >/dev/null 2>&1
    done
fi

if [ ! -f "$secrets/db-connection" ]; then
    printf '%s' 'Host=postgres;Port=5432;Database=gones;Username=gones_app;Password=local-app-only' > "$secrets/db-connection"
    random_hex 32 > "$secrets/auth-signing-key"
    random_hex 24 > "$secrets/brevo-webhook-token"
    random_hex 24 > "$secrets/brevo-api-key"
    random_hex 24 > "$secrets/oauth-google-secret"
    random_hex 24 > "$secrets/oauth-facebook-secret"
    random_hex 32 > "$secrets/backup-key"
fi

# Non-root service accounts read these; nothing writes them again.
chmod 0555 "$certs" "$secrets"
chmod 0444 "$certs"/*.pem "$secrets"/*
chmod 0440 "$certs"/*.key
chown -R 101:101 "$certs" 2>/dev/null || true
chmod 0444 "$certs"/*.key

# The backup command runs as its own unprivileged account and owns its mount.
if [ -d /backups ]; then chown 65532:65532 /backups && chmod 0755 /backups; fi

# The rehearsal script on the host verifies the published TLS endpoint against this CA copy.
if [ -d /export ]; then
    cp "$certs/ca.pem" /export/ca.pem
    chmod 0444 /export/ca.pem
fi

echo "release-test bootstrap: certificates and secrets ready"
