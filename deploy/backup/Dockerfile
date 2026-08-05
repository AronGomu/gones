# Gones backup/restore — platform-agnostic Linux OCI image (C41).
#
# One image, two commands: `gones-backup.sh` writes an encrypted `pg_dump` archive to a mounted path,
# `gones-restore.sh` verifies and replays one.
#
# It is built on plain Alpine rather than the PostgreSQL server image on purpose: this is a client,
# and the server image declares a data volume it has no use for. The client is pinned to an exact
# package version so the dump format can never drift ahead of the server it was taken from.
#
# Remote object storage, retention sweeps and PITR stay deferred with the hosting decision; this image
# deliberately knows nothing but a DSN, a key and a mount.
ARG ALPINE_IMAGE=alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce

FROM ${ALPINE_IMAGE} AS runtime
ARG GONES_IMAGE_REVISION=unknown
ARG GONES_IMAGE_CREATED=1970-01-01T00:00:00Z
LABEL org.opencontainers.image.title="gones-backup" \
      org.opencontainers.image.description="Gones Calendar encrypted PostgreSQL backup and restore commands" \
      org.opencontainers.image.source="https://github.com/AronGomu/gones" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="Gones Calendar" \
      org.opencontainers.image.revision="${GONES_IMAGE_REVISION}" \
      org.opencontainers.image.created="${GONES_IMAGE_CREATED}"
RUN apk add --no-cache postgresql17-client=17.10-r0 openssl=3.5.7-r0 \
    && addgroup -g 65532 -S gones \
    && adduser -u 65532 -S -G gones gones
COPY deploy/backup/gones-backup.sh deploy/backup/gones-restore.sh /usr/local/bin/
RUN chmod 0555 /usr/local/bin/gones-backup.sh /usr/local/bin/gones-restore.sh
# The root filesystem is read-only; plaintext only ever lands on the /tmp tmpfs, archives on the mount.
ENV GONES_BACKUP_ROOT=/backups \
    TMPDIR=/tmp \
    HOME=/tmp
WORKDIR /tmp
USER 65532:65532
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/gones-backup.sh"]
