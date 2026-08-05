# Gones frontend — platform-agnostic Linux OCI image (C41).
#
# The release stage is a static file server only: no Node runtime, no server-side rendering, no
# vendor edge functions. Any host that can run an OCI image and terminate TLS can serve it.
ARG NODE_IMAGE=node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
ENV CYPRESS_INSTALL_BINARY=0
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development
ARG GONES_FRONTEND_AUTH_V1=false
ARG GONES_FRONTEND_ADMIN_V1=false
ARG GONES_FRONTEND_CALENDAR_V1=false
ARG GONES_FRONTEND_LEAGUE_SERVER=false
ARG GONES_FRONTEND_LIVE_SERVER=false
ARG GONES_FRONTEND_API_BASE_URL=http://127.0.0.1:5080
COPY --chown=node:node . .
RUN sed -i "s/authV1: false/authV1: ${GONES_FRONTEND_AUTH_V1}/" src/environments/environment.ts \
    && sed -i "s/adminV1: false/adminV1: ${GONES_FRONTEND_ADMIN_V1}/" src/environments/environment.ts \
    && sed -i "s/calendarV1: false/calendarV1: ${GONES_FRONTEND_CALENDAR_V1}/" src/environments/environment.ts \
    && sed -i "s/leagueServer: false/leagueServer: ${GONES_FRONTEND_LEAGUE_SERVER}/" src/environments/environment.ts \
    && sed -i "s/liveServer: false/liveServer: ${GONES_FRONTEND_LIVE_SERVER}/" src/environments/environment.ts \
    && sed -i "s|apiBaseUrl: ''|apiBaseUrl: '${GONES_FRONTEND_API_BASE_URL}'|" src/environments/environment.ts
USER node
EXPOSE 4200
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM dependencies AS build
ARG GONES_FRONTEND_AUTH_V1=false
ARG GONES_FRONTEND_ADMIN_V1=false
ARG GONES_FRONTEND_CALENDAR_V1=false
ARG GONES_FRONTEND_LEAGUE_SERVER=false
ARG GONES_FRONTEND_LIVE_SERVER=false
ARG GONES_FRONTEND_API_BASE_URL=http://127.0.0.1:5080
COPY . .
RUN sed -i "s/authV1: false/authV1: ${GONES_FRONTEND_AUTH_V1}/" src/environments/environment.prod.ts \
    && sed -i "s/adminV1: false/adminV1: ${GONES_FRONTEND_ADMIN_V1}/" src/environments/environment.prod.ts \
    && sed -i "s/calendarV1: false/calendarV1: ${GONES_FRONTEND_CALENDAR_V1}/" src/environments/environment.prod.ts \
    && sed -i "s/leagueServer: false/leagueServer: ${GONES_FRONTEND_LEAGUE_SERVER}/" src/environments/environment.prod.ts \
    && sed -i "s/liveServer: false/liveServer: ${GONES_FRONTEND_LIVE_SERVER}/" src/environments/environment.prod.ts \
    && sed -i "s|apiBaseUrl: ''|apiBaseUrl: '${GONES_FRONTEND_API_BASE_URL}'|" src/environments/environment.prod.ts \
    && npm run build

FROM ${NGINX_IMAGE} AS release
ARG GONES_FRONTEND_API_BASE_URL=http://127.0.0.1:5080
ARG GONES_IMAGE_REVISION=unknown
ARG GONES_IMAGE_CREATED=1970-01-01T00:00:00Z
LABEL org.opencontainers.image.title="gones-frontend" \
      org.opencontainers.image.description="Gones Calendar static single-page application" \
      org.opencontainers.image.source="https://github.com/AronGomu/gones" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="Gones Calendar" \
      org.opencontainers.image.revision="${GONES_IMAGE_REVISION}" \
      org.opencontainers.image.created="${GONES_IMAGE_CREATED}"
USER root
RUN rm -rf /etc/nginx/templates
COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
# Bake the exact API origin into connect-src; the container filesystem is read-only at runtime.
RUN sed -i "s|__GONES_API_ORIGIN__|${GONES_FRONTEND_API_BASE_URL}|g" /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/gones/browser /usr/share/nginx/html
ENV TMPDIR=/tmp
USER 101:101
EXPOSE 8080
# nginx drains in-flight requests on SIGQUIT; SIGTERM would abort them mid-response.
STOPSIGNAL SIGQUIT
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD ["wget", "-q", "--spider", "http://127.0.0.1:8080/health"]
