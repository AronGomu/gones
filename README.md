# Gones

Gones is an Angular single-page PWA for consulting tournament League results, exporting Gones source-data backups, and editing League source data.

## Data authority

Every build declares exactly one data authority — it is never inferred (ADR 0019):

| `dataMode` | Who owns the data | Capabilities |
| --- | --- | --- |
| `legacy-browser` | browser `localStorage` | frozen: browsing, League/Live editing, Settings, Gones Export and the private migration-bundle export. No API base URL, no auth, no admin, no Calendar V1. |
| `server` | the API PostgreSQL database | Calendar V1, auth, organizer and admin. The browser keeps only language, view preference, filters and the anonymous public read cache. |

There is no fallback between them. A build that declares `server` without an API base URL, or
`legacy-browser` with a server capability, fails the image build and then refuses to start — it never
degrades to the browser store. The repository default is `legacy-browser`, matching the current
static deployment; `compose.yaml` defaults to mandatory `server` mode.

## Stack

- Angular standalone components, Angular Router, Signals, zoneless change detection
- Angular Material UI with Gones dark metal / blood-red theme tokens
- Authority-bound backend bridge in `src/app/backend/`: browser `localStorage` in `legacy-browser` mode, the ASP.NET API in `server` mode
- Declared data mode in `src/app/config/data-authority.ts`
- Vitest for domain/unit tests
- Cypress for browser flows
- GitHub Pages static hosting through GitHub Actions

## Local setup

```bash
npm install
npm run dev
```

The app runs at `http://127.0.0.1:4200`.

## Legacy browser mode

No external backend is required. The browser store bridge keeps Leagues in `localStorage` under `gones.frontend.backend.v1` and Live drafts under `gones.live-tournaments.v1`.

- Everyone can consult League data, export backups, and edit source data.
- There is no login, authentication, or role-management UI: those capabilities exist only in server mode.
- Gones Export/Gones Restore remain the portability and backup mechanism, and Settings offers the private migration-bundle export used by the future cutover.
- The mode is **frozen**. New Calendar V1, auth and admin capabilities land in server mode only.

## Server mode

The ASP.NET API and its PostgreSQL database are the single authority. Every mutation is an explicit intent command guarded by the document version; there is no whole-document save and no browser CalendarEvent store. See `docs/RUNTIME_CONTRACT.md` for what a host must provide, and `DEPLOYMENT.md` for how each mode is built.

The public domain, DNS, CDN, hosting vendor, container registry, live email/OAuth providers and the live cutover from the legacy origin are all still deferred.

## Commands

```bash
npm run build
npm run build:pages
npm run lint
npm run test
npm run cy:run
```

## Data portability

Gones Export is JSON source-data backup only. League Export uses `kind: "league"`; Full Data Export uses `kind: "fullData"`.
