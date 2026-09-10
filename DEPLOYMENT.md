# Frontend Deployment Guide

> **The frontend is one artifact and it talks to the API.** The browser-store deployment described
> by earlier revisions of this guide is retired (ADR 0020): there is no static, backend-free build
> any more. For everything a generic Linux host must provide, see
> [`docs/RUNTIME_CONTRACT.md`](docs/RUNTIME_CONTRACT.md) and ADR 0018. No hosting vendor is chosen
> yet.
>
> **Running it day to day** — deploy ordering, rollback principles, secret rotation, the provider
> webhook, backup/restore, schema migrations, the bundle-import CLI and Admin bootstrap all live in
> [`docs/OPERATIONS.md`](docs/OPERATIONS.md). On-demand staging windows, safe drain, budget checks,
> and per-environment backup/restore are in [`docs/STAGING_OPERATIONS.md`](docs/STAGING_OPERATIONS.md).
>
> **The V1 release candidate** — what the artifact set is, how to reproduce it, what is still
> deferred: [`docs/RELEASE_NOTES_V1.md`](docs/RELEASE_NOTES_V1.md).
>
> **The approved staging foundation** — shared-host topology, on-demand lifecycle, cost/recovery
> gates and immutable promotion rules: [`docs/STAGING_FOUNDATION.md`](docs/STAGING_FOUNDATION.md).

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
with and needs the API reachable from the browser. The supported full-stack path is the release
container.

## Current workflow boundaries

GitHub Pages is **static publication only**, not a full-stack production release gate. The existing
`.github/workflows/deploy-pages.yml` workflow runs on `main` pushes or manual dispatch, builds the
Angular bundle, copies `index.html` to `404.html`, and deploys that static artifact. It starts no API,
PostgreSQL or Worker, injects no runtime config, and does not prove a production release. The Pages
artifact therefore cannot be used as evidence that the server-mode application is deployed.

`.github/workflows/static.yml` runs CI checks on pull requests and `main`, including backend tests,
frontend tests, build, audit and `npm run e2e:ci`. `.github/workflows/release-images.yml` builds,
verifies, scans and publishes source-SHA-tagged GHCR image artifacts on candidate branches.
`npm run release:candidate` and `npm run release:rehearsal` are local full-stack rehearsals, not live
production gates.

### Immutable promotion workflow

The approved promotion shape is **dev → staging → main**. The release workflow builds candidate
images once, scans them, publishes immutable GHCR images, attaches GitHub build provenance, signs each
digest through workflow OIDC, then records the verified manifest. A staging push invokes only the fixed
HTTPS deployment operation (`npm run release:deploy-staging`) under serialized `gones-staging-*`
concurrency. Migration exit, source tree, config revision, staging gate and exact digest manifest are
checked by `npm run release:promotion-check`; failure blocks rollout.

Promotion evidence rejects changed source/config, mutable tags, missing signatures/attestations, failed
migration and concurrent deployment. A future `main` handoff must reuse tested manifest/digests
without rebuilding. No production deployment is claimed here.

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

1. `/events` loads from the API without console errors; sign-in and role-protected routes use the
   API session and expected role guards.
2. Event, server Archive records and server-backed Live changes persist through the API. The merged
   Archive list also includes local records from `gones-archive-local` (`leagues`, `league-seasons`,
   `tournaments`), the sanctioned local Archive adapter (ADR 0028), routed by `local-` id; local
   records never sync with the API.
3. Anonymous visitors and plain `User` sessions use the sanctioned offline Live adapter (ADR 0021),
   backed by `gones-live` / `tournaments`; `Organizer` and `Admin` sessions use the server adapter.
   Live local records never sync with the API. Neither adapter becomes shared data authority.
4. Existing bundles exported before ADR 0020 still import through the offline Migrator CLI; no new
   browser migration bundle is produced.
5. Refreshing a nested route still loads the Angular app. For GitHub Pages, this is supplied by the
   workflow's copied `404.html`; other static hosts need their own documented fallback.

A Pages deployment can verify static asset publication and route fallback only. It cannot verify API,
PostgreSQL, Worker, auth, migrations, backups or full-stack production readiness.

## 3. If a static host needs a route fallback

Fallback configuration is host-specific. The current GitHub Pages workflow copies `index.html` to
`404.html`; no generic `_redirects` command is part of this deployment contract. The supported
full-stack deployment uses the release container and its nginx SPA fallback.

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

The API database is the authority for Events, server Archive records, auth, organizations, admin
and server-backed Live. Sanctioned browser-only exceptions remain: the offline Live adapter (ADR 0021),
backed by `gones-live` / `tournaments`, and merged local Archive adapter (ADR 0028), backed by
`gones-archive-local` with `leagues`, `league-seasons` and `tournaments` stores. Their records never
sync with the API; local Archive reads and writes route by the `local-` id prefix. There is no
whole-document server save and no browser CalendarEvent store. Browser preferences, public read cache
and the approved account-scoped unsent Event draft remain non-canonical.

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
