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

## 4. Cutover migration exporter (Export v4 / private migration bundle)

`localStorage` is origin-scoped: each website address (origin), each browser, and each
device holds its own copy of the legacy stores (`gones.frontend.backend.v1`,
`gones.live-tournaments.v1`, `gones.settings*`). Before the server cutover:

1. Deploy the app build containing the Settings → "Migration bundle (private)" exporter
   on **every legacy origin** still in use (GitHub Pages, any mirror or staging origin).
2. Inventory **every known device and browser** that ever held tournament data, and run
   the migration-bundle download on each one. Track each `sourceInstanceId` (shown in the
   UI and stored under `gones.migration.source-instance.v1`) plus the reported file hash
   and counts in the inventory sheet.
3. Collect the `*.private.json` bundles offline for the migration CLI (C38). The bundle
   contains private data (Live drafts); it must never be uploaded from the browser to the
   server or shared publicly.
4. Public v4 exports (`Export all leagues` / League export) stay safe to share: they only
   carry League/Result source and public Scheduled fields, protected by a checksum.
