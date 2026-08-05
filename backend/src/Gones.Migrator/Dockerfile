# Gones Migrator — platform-agnostic Linux OCI image (C41).
#
# Run-to-completion job image: the host schedules it before every API/Worker rollout. Migrations are
# idempotent, so a repeated run is a no-op rather than an error.
ARG DOTNET_SDK_IMAGE=mcr.microsoft.com/dotnet/sdk:10.0@sha256:72dd743782f2ae7e5476fd64f6a460045e3998dc862218b80e6944cba79a01b0
ARG DOTNET_RUNTIME_IMAGE=mcr.microsoft.com/dotnet/runtime:10.0@sha256:68d35011fe04a39cca38208d392ed48f2df15653633dca16dbc4582d07342b9f

FROM ${DOTNET_SDK_IMAGE} AS build
WORKDIR /src
COPY backend/ ./backend/
RUN dotnet restore backend/src/Gones.Migrator/Gones.Migrator.csproj --locked-mode
RUN dotnet publish backend/src/Gones.Migrator/Gones.Migrator.csproj -c Release --no-restore -o /out /p:UseAppHost=false

FROM ${DOTNET_RUNTIME_IMAGE} AS runtime
ARG GONES_IMAGE_REVISION=unknown
ARG GONES_IMAGE_CREATED=1970-01-01T00:00:00Z
LABEL org.opencontainers.image.title="gones-migrator" \
      org.opencontainers.image.description="Gones Calendar schema migration and import job" \
      org.opencontainers.image.source="https://github.com/AronGomu/gones" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="Gones Calendar" \
      org.opencontainers.image.revision="${GONES_IMAGE_REVISION}" \
      org.opencontainers.image.created="${GONES_IMAGE_CREATED}"
WORKDIR /app
COPY --from=build /out ./
ENV DOTNET_EnableDiagnostics=0 \
    DOTNET_RUNNING_IN_CONTAINER=true \
    TMPDIR=/tmp \
    HOME=/tmp
USER 1654:1654
STOPSIGNAL SIGTERM
ENTRYPOINT ["dotnet", "Gones.Migrator.dll"]
