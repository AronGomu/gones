# Frontend Deployment Guide

This project is an Angular single-page PWA that currently runs frontend-only. It can be deployed as static files and does **not** need a backend server online.

The recommended host for this repository is **Cloudflare Pages**.

## What gets deployed

- Build command: `npm run build`
- Production output directory: `dist/gones/browser`
- Runtime backend today: browser `localStorage` through the frontend backend bridge
- Required build-time config today: none
- Future backend config: `API_BASE_URL` once the Nest.js adapter is enabled

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

No app-specific environment variables are required while the app is frontend-only.

## 2. Verify the deployment

Open the deployed URL and check:

1. `/leagues` loads without console errors.
2. Users can view League data and download exports.
3. Users can create, restore, edit, and delete League data in browser storage without signing in.
4. No login, account menu, or role-management buttons are shown.
5. Refreshing a nested route still loads the Angular app.

Browser storage is per-device/per-browser. Use Gones Export/Gones Restore to move data between browsers until the Nest.js backend is introduced.

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

## 5. Future Nest.js backend cutover

The frontend already talks through `ApplicationBackend` in `src/app/backend/application-backend.ts`.

When the Nest.js API exists:

1. Implement the API routes represented by `NestApiBackend` in `src/app/backend/nest-api-backend.service.ts`.
2. Set `API_BASE_URL` / `environment.apiBaseUrl` for deployed builds.
3. Provide the Nest adapter for `APP_BACKEND` instead of the local frontend adapter.
4. Keep League export/restore available as the user-facing backup path.
