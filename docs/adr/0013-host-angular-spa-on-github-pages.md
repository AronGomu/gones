# Host the Angular SPA on GitHub Pages

Status: superseded — the GitHub Pages pipeline (`.github/workflows/deploy-pages.yml`) was retired in 2026-08; the release container described in `DEPLOYMENT.md` is the supported host.

Gones runs as a static frontend-only Angular application. The production site is published to GitHub Pages by `.github/workflows/deploy-pages.yml` whenever `main` changes.

The Pages build uses `/gones/` as its base path, creates `404.html` from the Angular entry point so direct SPA routes can boot, and preserves the historical `/pages/leagues.html` URL as a redirect to `/leagues`.

Cloudflare Pages remains a compatible alternative static host, but it is not the active deployment target.
