#!/bin/sh
# Gones encrypted PostgreSQL backup (C41).
#
# Writes exactly three files into GONES_BACKUP_ROOT, and nowhere else:
#   <name>.dump.enc      AES-256-CBC(PBKDF2) envelope around a pg_dump custom-format archive
#   <name>.dump.enc.sha256  checksum of the ciphertext, so corruption is caught before decryption
#   <name>.meta.json     provenance: when, which server, which cipher, which checksum algorithm
#
# Inputs are environment only, so any host that can mount a volume and inject a secret can schedule it.
#   GONES_BACKUP_ROOT       absolute directory, must already exist and be writable (a mount)
#   GONES_BACKUP_DSN[_FILE] libpq connection string
#   GONES_BACKUP_KEY[_FILE] passphrase; exactly one of the two forms
#   GONES_BACKUP_NAME       optional archive base name (default: gones-<UTC timestamp>)
set -eu
# Without pipefail a failing pg_dump would still produce a well-formed encryption of nothing.
set -o pipefail

fail() { echo "gones-backup: $1" >&2; exit "${2:-1}"; }

read_input() {
    # $1 = key name. Accepts KEY or KEY_FILE, never both.
    name="$1"
    direct="$(eval "printf '%s' \"\${${name}:-}\"")"
    file="$(eval "printf '%s' \"\${${name}_FILE:-}\"")"
    if [ -n "$direct" ] && [ -n "$file" ]; then fail "configure only one of ${name} or ${name}_FILE" 2; fi
    if [ -n "$file" ]; then
        [ -r "$file" ] || fail "${name}_FILE is not readable" 2
        direct="$(cat "$file")"
    fi
    [ -n "$direct" ] || fail "${name} or ${name}_FILE is required" 2
    printf '%s' "$direct"
}

: "${GONES_BACKUP_ROOT:=/backups}"
case "$GONES_BACKUP_ROOT" in
    /*) ;;
    *) fail "GONES_BACKUP_ROOT must be an absolute path" 2 ;;
esac
[ -d "$GONES_BACKUP_ROOT" ] || fail "GONES_BACKUP_ROOT does not exist; mount it" 2
[ -w "$GONES_BACKUP_ROOT" ] || fail "GONES_BACKUP_ROOT is not writable" 2

name="${GONES_BACKUP_NAME:-gones-$(date -u +%Y%m%dT%H%M%SZ)}"
case "$name" in
    */*|*..*|"") fail "GONES_BACKUP_NAME must be a plain file name" 2 ;;
esac

dsn="$(read_input GONES_BACKUP_DSN)"
if [ -n "${GONES_BACKUP_KEY_FILE:-}" ]; then
    [ -z "${GONES_BACKUP_KEY:-}" ] || fail "configure only one of GONES_BACKUP_KEY or GONES_BACKUP_KEY_FILE" 2
    [ -r "$GONES_BACKUP_KEY_FILE" ] || fail "GONES_BACKUP_KEY_FILE is not readable" 2
    [ -s "$GONES_BACKUP_KEY_FILE" ] || fail "GONES_BACKUP_KEY_FILE is empty" 2
    pass="file:$GONES_BACKUP_KEY_FILE"
else
    [ -n "${GONES_BACKUP_KEY:-}" ] || fail "GONES_BACKUP_KEY or GONES_BACKUP_KEY_FILE is required" 2
    pass="env:GONES_BACKUP_KEY"
fi

archive="$GONES_BACKUP_ROOT/$name.dump.enc"
staging="$archive.partial"
trap 'rm -f "$staging"' EXIT INT TERM

# Custom format keeps the archive selectively restorable; owners and grants come from the host's own
# role bootstrap (deploy/postgres/init-roles.sql), never from the dump.
pg_dump --dbname="$dsn" --format=custom --compress=9 --no-owner --no-privileges \
    | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "$pass" -out "$staging"

mv "$staging" "$archive"
trap - EXIT INT TERM
( cd "$GONES_BACKUP_ROOT" && sha256sum "$name.dump.enc" > "$name.dump.enc.sha256" )

server="$(psql --dbname="$dsn" --no-psqlrc --tuples-only --no-align --command 'SHOW server_version' 2>/dev/null || echo unknown)"
cat > "$GONES_BACKUP_ROOT/$name.meta.json" <<META
{
  "name": "$name",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "serverVersion": "$server",
  "clientVersion": "$(pg_dump --version | tr -d '\n')",
  "format": "pg_dump custom",
  "cipher": "aes-256-cbc/pbkdf2-600000",
  "checksum": "sha256"
}
META

echo "gones-backup: wrote $archive ($(wc -c < "$archive") bytes)"
