#!/bin/sh
# Gones encrypted PostgreSQL restore (C41).
#
# Refuses to touch the database until the archive has proven itself three times:
#   1. the recorded sha256 of the ciphertext still matches  -> exit 10 on corruption
#   2. the HMAC over the ciphertext verifies with the same passphrase -> exit 12 on tampering/wrong key/missing MAC
#   3. the decrypted stream really is a pg_dump archive     -> exit 11 on a wrong key
#
# Usage: gones-restore.sh <archive-name-or-path>   (or GONES_BACKUP_FILE)
#   GONES_BACKUP_ROOT       absolute directory holding the archive; nothing outside it is read
#   GONES_BACKUP_DSN[_FILE] libpq connection string of the target database
#   GONES_BACKUP_KEY[_FILE] passphrase; exactly one of the two forms
set -eu
set -o pipefail

fail() { echo "gones-restore: $1" >&2; exit "${2:-1}"; }

: "${GONES_BACKUP_ROOT:=/backups}"
case "$GONES_BACKUP_ROOT" in
    /*) ;;
    *) fail "GONES_BACKUP_ROOT must be an absolute path" 2 ;;
esac
[ -d "$GONES_BACKUP_ROOT" ] || fail "GONES_BACKUP_ROOT does not exist; mount it" 2

requested="${1:-${GONES_BACKUP_FILE:-}}"
[ -n "$requested" ] || fail "an archive name is required" 2
name="$(basename "$requested")"
case "$name" in
    */*|*..*|"") fail "the archive must be a plain file name inside GONES_BACKUP_ROOT" 2 ;;
esac
archive="$GONES_BACKUP_ROOT/$name"
[ -f "$archive" ] || fail "archive $name not found under GONES_BACKUP_ROOT" 2

if [ -n "${GONES_BACKUP_KEY_FILE:-}" ]; then
    [ -z "${GONES_BACKUP_KEY:-}" ] || fail "configure only one of GONES_BACKUP_KEY or GONES_BACKUP_KEY_FILE" 2
    [ -r "$GONES_BACKUP_KEY_FILE" ] || fail "GONES_BACKUP_KEY_FILE is not readable" 2
    pass="file:$GONES_BACKUP_KEY_FILE"
else
    [ -n "${GONES_BACKUP_KEY:-}" ] || fail "GONES_BACKUP_KEY or GONES_BACKUP_KEY_FILE is required" 2
    pass="env:GONES_BACKUP_KEY"
fi

if [ -f "$archive.sha256" ]; then
    ( cd "$GONES_BACKUP_ROOT" && sha256sum -c "$name.sha256" >/dev/null 2>&1 ) \
        || fail "checksum mismatch: $name is corrupt, refusing to restore" 10
else
    fail "no $name.sha256 next to the archive, refusing to restore an unverifiable dump" 10
fi

# Strict by decision: an archive without a valid MAC is not restorable. The checksum above only
# proves the bytes are self-consistent; the MAC proves they are the bytes the backup wrote.
[ -f "$archive.hmac" ] || fail "no $name.hmac next to the archive, refusing to restore an unauthenticated archive" 12
read -r mac_version mac_kdf mac_salt mac_expected < "$archive.hmac" || true
if [ "${mac_version:-}" != "v1" ] || [ "${mac_kdf:-}" != "pbkdf2-sha256-600000" ] || [ -z "${mac_salt:-}" ] || [ -z "${mac_expected:-}" ]; then
    fail "unsupported MAC format in $name.hmac, refusing to restore" 12
fi
mac_key="$(openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -S "$mac_salt" -pass "$pass" -P | sed -n 's/^key=//p')"
mac_actual="$(openssl dgst -sha256 -mac HMAC -macopt hexkey:"$mac_key" -r "$archive" | cut -d' ' -f1)"
[ "$mac_actual" = "$mac_expected" ] || fail "MAC verification failed: $name was tampered with or the key is wrong, refusing to restore" 12

plaintext="${TMPDIR:-/tmp}/gones-restore-$$.dump"
trap 'rm -f "$plaintext"' EXIT INT TERM

openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "$pass" -in "$archive" -out "$plaintext" 2>/dev/null \
    || fail "decryption failed: wrong key or damaged envelope" 11

# A wrong passphrase can still decrypt to plausible-looking bytes; the archive magic is the real proof.
magic="$(head -c 5 "$plaintext" 2>/dev/null || true)"
[ "$magic" = "PGDMP" ] || fail "decrypted payload is not a pg_dump archive: wrong key" 11

dsn="${GONES_BACKUP_DSN:-}"
if [ -n "${GONES_BACKUP_DSN_FILE:-}" ]; then
    [ -z "$dsn" ] || fail "configure only one of GONES_BACKUP_DSN or GONES_BACKUP_DSN_FILE" 2
    [ -r "$GONES_BACKUP_DSN_FILE" ] || fail "GONES_BACKUP_DSN_FILE is not readable" 2
    dsn="$(cat "$GONES_BACKUP_DSN_FILE")"
fi
[ -n "$dsn" ] || fail "GONES_BACKUP_DSN or GONES_BACKUP_DSN_FILE is required" 2

if [ "${GONES_BACKUP_VERIFY_ONLY:-false}" = "true" ]; then
    echo "gones-restore: $name verified (checksum and archive magic), no restore requested"
    exit 0
fi

pg_restore --dbname="$dsn" --clean --if-exists --no-owner --no-privileges --exit-on-error "$plaintext"
echo "gones-restore: restored $name"
