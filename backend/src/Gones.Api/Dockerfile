# Gones API — platform-agnostic Linux OCI image (C41).
#
# Contract: no cloud SDK, no vendor runtime, no writable root filesystem. Everything the host has to
# supply arrives as environment variables, mounted secret files, and a TLS-terminating reverse proxy.
# Base images are pinned by digest so a rebuild of the same commit produces the same layers.
ARG DOTNET_SDK_IMAGE=mcr.microsoft.com/dotnet/sdk:10.0@sha256:72dd743782f2ae7e5476fd64f6a460045e3998dc862218b80e6944cba79a01b0
ARG DOTNET_ASPNET_IMAGE=mcr.microsoft.com/dotnet/aspnet:10.0@sha256:f1126d438ccc359f51cc6d4701a8deae513856cf10f5fe645d29ea6403dcac6b

FROM ${DOTNET_SDK_IMAGE} AS build
WORKDIR /src
COPY backend/ ./backend/
RUN dotnet restore backend/src/Gones.Api/Gones.Api.csproj --locked-mode
RUN dotnet publish backend/src/Gones.Api/Gones.Api.csproj -c Release --no-restore -o /out /p:UseAppHost=false

FROM ${DOTNET_ASPNET_IMAGE} AS runtime
ARG GONES_IMAGE_REVISION=unknown
ARG GONES_IMAGE_CREATED=1970-01-01T00:00:00Z
LABEL org.opencontainers.image.title="gones-api" \
      org.opencontainers.image.description="Gones Calendar HTTP API" \
      org.opencontainers.image.source="https://github.com/AronGomu/gones" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="Gones Calendar" \
      org.opencontainers.image.revision="${GONES_IMAGE_REVISION}" \
      org.opencontainers.image.created="${GONES_IMAGE_CREATED}"
WORKDIR /app
COPY --from=build /out ./
# Read-only root filesystem: the only writable path the process needs is the host-provided /tmp
# tmpfs. Diagnostics are off so the runtime does not try to create its IPC socket outside it.
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_FORWARDEDHEADERS_ENABLED=false \
    DOTNET_EnableDiagnostics=0 \
    DOTNET_RUNNING_IN_CONTAINER=true \
    TMPDIR=/tmp \
    HOME=/tmp
USER 1654:1654
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/8080; printf 'GET /health/live HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n' >&3; grep -q '200 OK' <&3"]
ENTRYPOINT ["dotnet", "Gones.Api.dll"]
