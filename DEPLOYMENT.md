# Frontend Deployment Guide

> **The frontend is one artifact and it talks to the API.** The browser-store deployment described
> by earlier revisions of this guide is retired (ADR 0020): there is no static, backend-free build
> any more. For everything a generic Linux host must provide, see
> [`docs/RUNTIME_CONTRACT.md`](docs/RUNTIME_CONTRACT.md) and ADR 0018. No hosting vendor is chosen
> yet.
>
> **Running it day to day** — deploy ordering, rollback principles, secret rotation, the provider
> webhook, backup/restore, schema migrations, the bundle-import CLI and Admin bootstrap all live in
> [`docs/OPERATIONS.md`](docs/OPERATIONS.md).
>
> **The V1 release candidate** — what the artifact set is, how to reproduce it, what is still
> deferred: [`docs/RELEASE_NOTES_V1.md`](docs/RELEASE_NOTES_V1.md).

## Data authority: declared, and there is only one

Every frontend artifact declares its data authority (ADR 0020). `server` is the only legal value —
the API PostgreSQL database owns the data, and no build can sit anywhere else.

| Build arg | Value |
| --- | --- |
| `GONES_FRONTEND_DATA_MODE` | `server` (anything else fails the build) |
| `GONES_FRONTEND_API_BASE_URL` | required, the exact API origin |
| `GONES_FRONTEND_AUTH_V1` | optional, defaults to `true` |
| `GONES_FRONTEND_ADMIN_V1` | optional, defaults to `true`, requires auth |

An incoherent declaration fails `scripts/check-frontend-data-authority.mjs` during the image build,
is refused again by `deploy/nginx/gones-data-authority.sh` at container start, and a hand-edited
artifact refuses to bootstrap in the browser rather than running with no data source.

## The artifact is not bound to an origin

The release image reads `GONES_DATA_MODE`, `GONES_API_BASE_URL`, `GONES_AUTH_V1` and
`GONES_ADMIN_V1` at container start and renders `/runtime-config.json` plus the CSP `connect-src`
into a tmpfs. The build arguments above are only the artifact's defaults, so the same image can be
served on any origin without rebuilding it.

## What gets deployed

- Build command: `npm run build`
- Production output directory: `dist/gones/browser`
- Declared data authority: `server` (the repository default in `src/environments/environment*.ts`)
- Runtime backend: the ASP.NET API over HTTP
- Required config: an API origin — at build time, at container start, or both

Static-file hosts (Cloudflare Pages, GitHub Pages and friends) can still serve the bundle, but they
cannot inject a runtime declaration, so such a deployment is pinned to whatever origin it was built
with and needs the API reachable from the browser. The supported path is the release container.

## 1. Serve it from the release image

```bash
docker compose --profile release up --build -d
```

The SPA answers on `http://127.0.0.1:8081` and the API on `http://127.0.0.1:5080`. To point the same
image at another origin, set `GONES_API_BASE_URL` on the container and restart it.

For local development with hot reload, use `npm run dev` — it starts the API stack in Docker and
serves the app against it.

## 2. Verify the deployment

Open the deployed URL and check:

1. `/leagues` loads without console errors.
2. Users can view League data and download exports.
3. Users can create, restore, edit, and delete League data in browser storage without signing in.
4. No login, account menu, or role-management buttons are shown, and `/login`, `/registrations`,
   `/organizer/tournaments` and `/admin` all render the Not Found page.
5. Refreshing a nested route still loads the Angular app.
6. Settings still offers the private migration-bundle export, and the browser issues no `/api/`
   request at any point.

## 3. If direct route refreshes 404

Angular routes such as `/leagues` and `/players/Alice` need a static-host fallback to `index.html`.

If a static host does not handle this automatically, add a `_redirects` file to the built site with this content:

```text
/* /index.html 200
```

For this Angular project, that means adding `src/_redirects` and including it in the `assets` array in `angular.json` so it is copied to `dist/gones/browser/_redirects`.

## 4. Local production build check

Before deploying, you can check the production build locally:

```bash
npm ci
npm run lint
npm run test
npm run build
```

The built frontend will be in:

```text
dist/gones/browser
```

## 5. Building the artifact

1. Build the image with `GONES_FRONTEND_API_BASE_URL=<an API origin>` (`GONES_FRONTEND_DATA_MODE`
   already defaults to `server`, the only legal value). These are the artifact's **defaults**, not a
   binding: they decide what the image serves when the host injects nothing.
2. Optionally add `GONES_FRONTEND_AUTH_V1=true` and `GONES_FRONTEND_ADMIN_V1=true`; admin requires auth.
3. Serve it anywhere by injecting the declaration at container start — `GONES_DATA_MODE`,
   `GONES_API_BASE_URL`, `GONES_AUTH_V1`, `GONES_ADMIN_V1`. The entrypoint validates the pair, writes
   `/runtime-config.json` (read by the app before it bootstraps) and renders the nginx `connect-src`
   from the same origin, so the CSP cannot drift. An incoherent declaration exits the container.
   **One artifact, any domain or CDN: moving origins never needs a rebuild.**
4. Point the API at its PostgreSQL database and follow [`docs/RUNTIME_CONTRACT.md`](docs/RUNTIME_CONTRACT.md).

The database is the single authority: there is no whole-document League/Live save and no browser
CalendarEvent store, and the browser keeps only language, view preference, filters and the anonymous
public read cache.

## 6. Deferred: domain, CDN and providers

Still explicitly **not** decided, and not implied anywhere in this repository:

- Public domain and DNS, CDN or edge configuration, and the hosting vendor.
- Managed PostgreSQL, managed secret store, container registry and image signing trust (ADR 0018).
- Live email (Brevo) and OAuth provider credentials — every local and CI run uses fakes by design.
- **A live cutover from a browser-store origin.** No longer possible from this revision: ADR 0020
  retired the browser authority and with it the Settings migration export, which was the only thing
  that could produce a private bundle. The offline Migrator CLI, the Export v4 and bundle schemas and
  `npm run migration:smoke` all remain, so bundles exported **before** that change still import and
  are still rehearsed on every release. Anything not exported by then is recoverable only by
  reverting that commit.
