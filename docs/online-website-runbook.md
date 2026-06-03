# Online Website Runbook

Gones currently deploys as a static Angular PWA with frontend-only browser storage.

## 1. Build and deploy

Use Cloudflare Pages or any static host that can serve `dist/gones/browser`.

Recommended Cloudflare settings:

| Setting | Value |
| --- | --- |
| Node version | `24` |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist/gones/browser` |

No backend environment variables are required while the app uses the local frontend backend bridge.

## 2. Smoke test

After deployment:

1. Open `/leagues`.
2. Confirm the Leagues page and header Import control load.
3. Open the demo League.
4. Confirm no login/account/role-management controls are visible.
5. Create a League, edit it, export it, refresh the page, and confirm the data remains in browser storage.
6. Refresh a nested route and confirm the static-host SPA fallback works.

## 3. Operational notes

- Browser storage is per-device/per-browser.
- Ask users to export backups before clearing browser data.
- Use Gones Restore to move data between browsers.
- The future Nest.js API should implement the `ApplicationBackend` contract before becoming the production backend.
