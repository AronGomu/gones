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

The Pages artifact includes a `404.html` SPA fallback for direct route refreshes. The archive is served at `/archive/league-seasons` and `/archive/tournaments`; the retired `/leagues` and `/leagues-archive/**` URLs are not aliased and render the 404 page. No backend environment variables are required while the app uses the local frontend backend bridge.

## 2. Smoke test

After deployment:

1. Open `https://arongomu.github.io/gones/archive/league-seasons`.
2. Confirm the League Season table and the header Import control load.
3. Open a Season, then open one of its Tournaments.
4. Confirm no login/account/role-management controls are visible.
5. Import a v5 archive bundle, edit a Tournament, export it, refresh the page, and confirm the data remains in browser storage.
6. Refresh a nested route and confirm the static-host SPA fallback works.
7. Open `https://arongomu.github.io/gones/leagues-archive` and confirm it renders the 404 page with the address bar unchanged.

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

## 5. Cutover migration CLI (dry run first, then one transaction)

The importer lives in `Gones.Migrator` and is deliberately dry-run-first: it never writes
without an operator-reviewed report hash.

```
dotnet Gones.Migrator.dll import \
    --bundle <bundle.private.json> [--bundle <another.private.json>...] \
    --manifest <manifest.json> --mapping <mapping.json> \
    [--dry-run] [--accept-report-hash sha256:...] [--report <report.json>]
```

**Manifest** (`kind: gones.migration-manifest`) inventories every collected
`sourceInstanceId` with its `bundleChecksum` and a `role` (exactly one `authoritative`,
the rest `secondary`). Unknown duplicates or conflicting copies of the same entity block
the import until the operator resolves them explicitly in `resolutions`, keyed
`league:<id>` / `live:<id>` / `tournament:<id>` / `calendarEvent:<id>` with either `skip`
or `use:<sourceInstanceId>`.

**Mapping** (`kind: gones.migration-mapping`) supplies what legacy Calendar events never
carried: `organizationId`, `ownerUserId`, and — per event — the mandatory start time, IANA
`timeZone`, address/city/country, `formatSlugs` (the `legacy` Format applies only when it
is explicitly listed), `status` (`published` or `cancelled`) and optional capacity. There
is no global default: every legacy event needs its own entry or the import is blocked.

Procedure:

1. Run with `--dry-run`. Review the human summary and the JSON report: input counts,
   source instances, per-event mappings, sanitation changes (removed images, stripped
   unsafe HTML, dropped/converted `externalLink`), collisions, entity hashes and the
   target database identity. Any error blocks the import.
2. Rerun without `--dry-run`, passing `--accept-report-hash <reportHash>` from that
   unchanged dry run. If the bundles, manifest, mapping or target database changed, the
   hash no longer matches and a fresh dry run is required.
3. The import runs as one serializable transaction across League aggregates, Scheduled
   Tournaments, Live drafts and the Deck Archetype catalog, writes an audit record and a
   migration batch idempotency record, then runs the post-import verifier (counts,
   canonical hashes, sampled derived League result parity). Any failure rolls the whole
   batch back — there are no partial rows.
4. Rerunning an already imported batch returns the stored result instead of importing
   again. Audit records and metrics carry only a truncated batch hash, never bundle
   contents.

`npm run migration:smoke` exercises this whole flow (including a forced mid-import
failure) against the local compose stack.
