# Gones

Gones is an Angular single-page PWA for consulting tournament League results, exporting Gones source-data backups, and editing League source data in a frontend-only browser store.

## Stack

- Angular standalone components, Angular Router, Signals, zoneless change detection
- Angular Material UI with Gones dark metal / blood-red theme tokens
- Frontend-only backend bridge backed by browser `localStorage`
- Future ASP.NET adapter contract in `src/app/backend/`
- Vitest for domain/unit tests
- Cypress for browser flows
- GitHub Pages static hosting through GitHub Actions

## Local setup

```bash
npm install
npm run dev
```

The app runs at `http://127.0.0.1:4200`.

## Frontend-only data

No external backend is required today. The current bridge implementation stores Leagues in browser `localStorage` under `gones.frontend.backend.v1`.

- Everyone can consult League data, export backups, and edit source data in the MVP.
- Admin and Organizer remain product design concepts for a later backend-backed version, but there is no login, authentication, or role-management UI in this frontend-only release.
- Gones Export/Gones Restore remain the portability and backup mechanism.

If you are cutting over from any previous hosted backend, export League/Full Data JSON from the old deployment before deploying this frontend-only build, then restore it in the new app. When a ASP.NET backend is added later, implement/provide the `ApplicationBackend` bridge from `src/app/backend/application-backend.ts`; UI components and repositories should not need to call HTTP directly.

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
