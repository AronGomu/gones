FROM node:24-alpine AS dependencies
WORKDIR /app
ENV CYPRESS_INSTALL_BINARY=0
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development
ARG GONES_FRONTEND_AUTH_V1=false
ARG GONES_FRONTEND_ADMIN_V1=false
ARG GONES_FRONTEND_CALENDAR_V1=false
ARG GONES_FRONTEND_LEAGUE_SERVER=false
ARG GONES_FRONTEND_API_BASE_URL=http://127.0.0.1:5080
COPY --chown=node:node . .
RUN sed -i "s/authV1: false/authV1: ${GONES_FRONTEND_AUTH_V1}/" src/environments/environment.ts \
    && sed -i "s/adminV1: false/adminV1: ${GONES_FRONTEND_ADMIN_V1}/" src/environments/environment.ts \
    && sed -i "s/calendarV1: false/calendarV1: ${GONES_FRONTEND_CALENDAR_V1}/" src/environments/environment.ts \
    && sed -i "s/leagueServer: false/leagueServer: ${GONES_FRONTEND_LEAGUE_SERVER}/" src/environments/environment.ts \
    && sed -i "s|apiBaseUrl: ''|apiBaseUrl: '${GONES_FRONTEND_API_BASE_URL}'|" src/environments/environment.ts
USER node
EXPOSE 4200
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM dependencies AS build
ARG GONES_FRONTEND_AUTH_V1=false
ARG GONES_FRONTEND_ADMIN_V1=false
ARG GONES_FRONTEND_CALENDAR_V1=false
ARG GONES_FRONTEND_LEAGUE_SERVER=false
ARG GONES_FRONTEND_API_BASE_URL=http://127.0.0.1:5080
COPY . .
RUN sed -i "s/authV1: false/authV1: ${GONES_FRONTEND_AUTH_V1}/" src/environments/environment.prod.ts \
    && sed -i "s/adminV1: false/adminV1: ${GONES_FRONTEND_ADMIN_V1}/" src/environments/environment.prod.ts \
    && sed -i "s/calendarV1: false/calendarV1: ${GONES_FRONTEND_CALENDAR_V1}/" src/environments/environment.prod.ts \
    && sed -i "s/leagueServer: false/leagueServer: ${GONES_FRONTEND_LEAGUE_SERVER}/" src/environments/environment.prod.ts \
    && sed -i "s|apiBaseUrl: ''|apiBaseUrl: '${GONES_FRONTEND_API_BASE_URL}'|" src/environments/environment.prod.ts \
    && npm run build

FROM nginxinc/nginx-unprivileged:1.29-alpine AS release
RUN rm -rf /etc/nginx/templates
COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/gones/browser /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD ["wget", "-q", "--spider", "http://127.0.0.1:8080/health"]
