# Frontend Deployment Guide

> **Server-mode hosting:** this guide covers the legacy static, frontend-only deployment. For the
> V1 server stack — API, Worker, Migrator, backup/restore images and everything a generic Linux host
> must provide — see [`docs/RUNTIME_CONTRACT.md`](docs/RUNTIME_CONTRACT.md) and ADR 0018. No hosting
> vendor is chosen for it yet.

## Data authority: pick one, explicitly

Every frontend artifact declares exactly one data authority (ADR 0019). There is no fallback between
them, and no build may sit between them.

| Build arg | `legacy-browser` (this guide) | `server` |
| --- | --- | --- |
| `GONES_FRONTEND_DATA_MODE` | `legacy-browser` | `server` |
| `GONES_FRONTEND_API_BASE_URL` | must be **empty** | required, exact origin |
| `GONES_FRONTEND_AUTH_V1` | must be `false` | optional |
| `GONES_FRONTEND_ADMIN_V1` | must be `false` | optional, requires auth |

An incoherent pair fails `scripts/check-frontend-data-authority.mjs` during the image build, and a
hand-edited artifact refuses to bootstrap in the browser instead of degrading to the browser store.

`compose.yaml` defaults to **mandatory server mode**. To rehearse the legacy static build locally,
set `GONES_FRONTEND_DATA_MODE=legacy-browser` **and** `GONES_FRONTEND_API_BASE_URL=` (empty) — that
is exactly what the legacy profile of `npm run e2e:ci` does.

This project is an Angular single-page PWA that currently runs frontend-only in `legacy-browser` mode. It can be deployed as static files and does **not** need a backend server online.

The recommended host for this repository is **Cloudflare Pages**.

## What gets deployed

- Build command: `npm run build`
- Production output directory: `dist/gones/browser`
- Declared data authority: `legacy-browser` (the repository default in `src/environments/environment*.ts`)
- Runtime backend: browser `localStorage` through the authority-bound backend bridge
- Required build-time config: none — and an API base URL must **not** be set

## 1. Deploy with Cloudflare Pages

1. Push this repository to GitHub.
2. In Cloudflare, go to **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
3. Select the GitHub repository.
4. Use these build settings:

| Setting | Value |
| --- | --- |
| Framework preset | Angular, or None if you enter settings manually |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist/gones/browser` |
| Root directory | leave blank |
| Node version | `24` |

Add a Cloudflare Pages environment variable:

```text
NODE_VERSION=24
```

No app-specific environment variables are required for the `legacy-browser` build. Do not set an API
base URL here: a legacy artifact carrying one fails closed rather than talking to a server.

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

Browser storage is per-device/per-browser. Use Gones Export/Gones Restore to move data between browsers until the ASP.NET backend is introduced.

## 3. If direct route refreshes 404

Angular routes such as `/leagues` and `/players/Alice` need a static-host fallback to `index.html`.

If Cloudflare Pages does not handle this automatically, add a `_redirects` file to the built site with this content:

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

## 5. Server-mode build

The API exists; the cutover is what is deferred. To build a server-mode artifact:

1. Build the image with `GONES_FRONTEND_DATA_MODE=server` and `GONES_FRONTEND_API_BASE_URL=<exact API origin>`.
   The origin is also baked into the nginx `connect-src` directive, so it cannot drift from the CSP.
2. Optionally add `GONES_FRONTEND_AUTH_V1=true` and `GONES_FRONTEND_ADMIN_V1=true`; admin requires auth.
3. Point the API at its PostgreSQL database and follow [`docs/RUNTIME_CONTRACT.md`](docs/RUNTIME_CONTRACT.md).

In server mode the database is the single authority: there is no whole-document League/Live save and
no browser CalendarEvent store, and the browser keeps only language, view preference, filters and the
anonymous public read cache.

## 6. Deferred: domain, CDN, providers and the live cutover

Still explicitly **not** decided, and not implied anywhere in this repository:

- Public domain and DNS, CDN or edge configuration, and the hosting vendor for either mode.
- Managed PostgreSQL, managed secret store, container registry and image signing trust (ADR 0018).
- Live email (Brevo) and OAuth provider credentials — every local and CI run uses fakes by design.
- **The live cutover itself.** Legacy `localStorage` is origin- and device-scoped, so the cutover
  runbook must inventory every legacy origin/browser, export a private migration bundle from each
  (Settings → migration export), run the offline Migrator CLI dry-run, approve the report hash, and
  import — then soak before the legacy build is retired. The cutover bundle UI, the Export v4 and
  bundle schemas and the Migrator CLI all stay in the repository until that soak explicitly
  authorizes their removal.
