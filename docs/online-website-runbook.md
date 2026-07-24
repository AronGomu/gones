# Online Website Runbook

Gones currently deploys as a static Angular PWA with frontend-only browser storage.

## 1. Build and deploy

GitHub Pages is the active production host. A push to `main` triggers `.github/workflows/deploy-pages.yml`, which installs dependencies, builds the Angular app for the `/gones/` project path, uploads `dist/gones/browser`, and deploys it to the `github-pages` environment.

| Setting | Value |
| --- | --- |
| Node version | `.nvmrc` |
| Build command | `npm ci && npm run build:pages` |
| Build output directory | `dist/gones/browser` |
| Production URL | `https://arongomu.github.io/gones/` |

The Pages artifact includes a `404.html` SPA fallback for direct route refreshes. The historical `/pages/leagues.html` URL redirects to `/leagues`. No backend environment variables are required while the app uses the local frontend backend bridge.

## 2. Smoke test

After deployment:

1. Open `https://arongomu.github.io/gones/leagues`.
2. Confirm the Leagues page and header Import control load.
3. Open the demo League.
4. Confirm no login/account/role-management controls are visible.
5. Create a League, edit it, export it, refresh the page, and confirm the data remains in browser storage.
6. Refresh a nested route and confirm the static-host SPA fallback works.

## 3. Operational notes

- Browser storage is per-device/per-browser.
- Ask users to export backups before clearing browser data.
- Use Gones Restore to move data between browsers.
- The future ASP.NET API should implement the `ApplicationBackend` contract before becoming the production backend.
