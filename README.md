# Gones

Gones is an Angular single-page PWA for consulting tournament League results, exporting Gones source-data backups, and letting Organizer/Admin users edit League source data in a frontend-only browser store.

## Stack

- Angular standalone components, Angular Router, Signals, zoneless change detection
- Angular Material UI with Gones dark metal / blood-red theme tokens
- Frontend-only backend bridge backed by browser `localStorage`
- Future Nest.js adapter contract in `src/app/backend/`
- Vitest for domain/unit tests
- Cypress for browser flows
- Cloudflare Pages static hosting

## Local setup

```bash
npm install
npm run dev
```

The app runs at `http://127.0.0.1:4200`.

## Frontend-only data and auth

No external backend is required today. The current bridge implementation stores Leagues, Authorized Users, and the local session in browser `localStorage` under `gones.frontend.backend.v1`.

- Visitors can consult League data and export backups.
- Use **Sign in locally** with `admin@example.com` to unlock the bootstrap local Admin User.
- Admin Users can add Organizer/Admin emails from `/admin/users`.
- Gones Export/Gones Restore remain the portability and backup mechanism.

If you are cutting over from any previous hosted backend, export League/Full Data JSON from the old deployment before deploying this frontend-only build, then restore it in the new app. When a Nest.js backend is added later, implement/provide the `ApplicationBackend` bridge from `src/app/backend/application-backend.ts`; UI components and repositories should not need to call HTTP directly.

## Commands

```bash
npm run build
npm run lint
npm run test
npm run cy:run
```

## Data portability

Gones Export is JSON source-data backup only. League Export uses `kind: "league"`; Full Data Export uses `kind: "fullData"`.
