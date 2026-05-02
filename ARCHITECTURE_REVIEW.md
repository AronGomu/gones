# Architecture Review of **Gones**

---

## 1️⃣ What the codebase *does* – high‑level picture

| Area | Key files | What they represent / do |
|------|-----------|--------------------------|
| **Domain model** | `class/League.js`, `class/Tournament.js`, `class/Match.js`, `class/Player.js`, `class/PlayerResult.js`, `class/Standing.mjs` | Plain JavaScript classes (no framework) that model the core entities: a **League** holds a list of tournaments, a **Tournament** holds rounds, standings and metadata, **Match** stores the result of a single game, **Player** is just a name holder, **Standing** aggregates a player’s record (wins, draws, OMW, etc.) and provides a `addStanding` helper. |
| **Parsing helpers** | `class/League.js` (`parseLeague`, `parseLeagueList`), `class/Tournament.js` (`parseTournament`, `parseTournamentList`) | Simple JSON‑to‑object converters used when data is read from `localStorage`. |
| **Utility functions** | `function/utils.js` | URL‑param extraction, local‑storage persistence, date formatting, deep‑copy, number‑truncation. |
| **UI components (custom elements)** | `component/GonesTable.js`, `component/CustomTable.js` | `GonesTable` is a hand‑rolled “table” element that receives data via its `build()` method, renders a Bulma‑styled table and emits an `edit‑row` event when a row is clicked. `CustomTable` is an unfinished Lit‑Element that never gets used. |
| **Pages (HTML + JS)** | `page/*.html`, `page/*.js` | Each page is a small single‑page‑app driven by vanilla JS:  
  * `leagues.html / leagues.js` – list leagues, create a new league, navigate to edit screen.  
  * `edit_league.html / edit_league.js` – edit a league’s name, dates, add/delete tournaments, view league‑wide standings.  
  * `edit_tournament.html / edit_tournament.js` – edit a single tournament, import CSV/URL data, show tournament standings. |
| **Static data / mocks** | `mock/*.js`, `data/test.csv` | Example JSON structures used during development (not yet wired into the UI). |
| **Styling** | `style/*.css`, Bulma CSS library | Global styling + Bulma theme. |
| **Library** | `library/lit.js` | Re‑export of the Lit library; only referenced by the abandoned `CustomTable`. |
| **Entry point** | `index.html` (not shown but presumably loads a **menu** page) | Provides navigation to the three main screens. |

### Data flow (as it currently works)
1. **Persistence** – All data lives in `localStorage` under keys like `league_list`. Page scripts read those keys synchronously (`JSON.parse(localStorage.getItem(...))`).
2. **Parsing** – `parseLeagueList` creates real `League` objects (and each league creates its own `Tournament` objects via `parseTournamentList`).
3. **Rendering** – Each page grabs the target `<gones-table>` element and calls `build(title, headerList, idList, typeList, rowList)`. The component iterates over the raw objects (`row_list`) and injects cells based on the supplied `type_list` (`date`, `edit`, etc.).
4. **Interaction** – Clicking a row fires `edit-row`; the page listens and redirects (`window.location.href = "edit_…html?id=…"`) to the edit screen for that entity.
5. **Creation / Deletion** – UI has only *navigation* callbacks (`createLeague`, `createTournament`, `delete…`) that forward the user to the edit page. The actual creation/deletion logic is missing – it never writes to `localStorage`.
6. **Import** – The tournament edit page contains a UI for CSV / URL import, but there is **no JavaScript** that parses a CSV file, validates it or updates the tournament objects.

---

## 2️⃣ Critique – what’s good and what’s lacking

### ✅ What works / is promising
| Strength | Explanation |
|----------|-------------|
| **Clear domain separation** | Entities (`League`, `Tournament`, `Standing`, …) are isolated in their own files, making them easy to unit‑test (once tests are added). |
| **Custom‑element table** | `GonesTable` encapsulates the table layout, `build()` API is declarative, and the `edit-row` custom event gives a clean hook for the page to react. |
| **Pure front‑end approach** | No backend is required; everything stays in the browser, which fits the “pure‑javascript” goal. |
| **Use of Bulma** | Provides a decent responsive base without pulling in a heavyweight UI framework. |
| **Reusable utilities** | `utils.js` centralises URL‑param handling, local‑storage saving, date formatting, etc. |

### ❌ Architectural / implementation problems
| Problem | Why it matters | Suggested fix |
|---------|----------------|--------------|
| **No state‑management layer** | All pages read/write `localStorage` directly, leading to duplicated parsing logic and a high risk of out‑of‑sync UI. | Introduce a tiny store module (e.g., `src/store.js`) that owns the master `state = { leagues: [], tournaments: [] }` and provides `get`, `set`, `subscribe` helpers. All UI scripts import the store instead of touching `localStorage` directly. |
| **Inconsistent module systems** | Some files use ES‑modules, others are plain script tags that expose globals. Mixing makes bundling hard and can cause duplicate definitions. | Standardise on ES‑modules everywhere (`type="module"` for *all* `<script>` tags) and export the custom elements (`export class GonesTable …`). |
| **`CustomTable` is dead code** | It imports `LitElement` but never gets used; the component still references undefined `css` and `this.name_list`/`this.id_list`. | Delete `CustomTable` or finish the Lit‑Element implementation and replace `GonesTable` with it (Lit would give better templating & reactivity). |
| **Missing CRUD logic** | “Create league”, “Delete tournament”, “Add tournament to a league” only navigate; they never mutate data or persist it. | Implement `createLeague()`, `saveLeague()`, `deleteLeague(id)`, `addTournamentToLeague(leagueId, tournament)`, etc., and make them call the store which persists to `localStorage`. |
| **No validation / error handling on imports** | Architecture docs mention “show error if CSV malformed”, but there is no parser or UI feedback. Users can paste anything and the app will silently break. | Add a CSV parser (`PapaParse` or a tiny hand‑rolled one) in `function/utils.js`, validate each line against the expected schema, and surface errors (e.g., using a modal or the existing `QualityAlertList` component). |
| **Loose coupling between pages** | Navigation is performed by manually building URLs and reading query strings. This makes deep‑linking fragile because each page must re‑parse the entire `localStorage` blob. | Use a router library (or a minimal hash‑router) that keeps the current league/tournament id in the URL *and* in the central store, so pages can request “the current league” without re‑reading everything. |
| **Standing calculation is incomplete** | `Standing` class can aggregate other standings, but there is no code that actually builds league‑wide standings from tournament results. The UI shows a standings table but it never receives data. | Implement a service (`src/standings.js`) that iterates over all tournaments in a league, aggregates `Standing` objects, and updates the store. |
| **File‑system layout not modular** | All source code lives at the repository root (`class/`, `component/`, `page/`, `function/`). | Restructure to `src/models`, `src/components`, `src/pages`, `src/services`. |
| **No testing** | No unit tests for domain classes and no integration tests for UI. | Add a test framework (Jest or Vitest) and write tests for parsing, standing aggregation, CSV import validation, and component rendering. |
| **No build pipeline** | The repo ships raw `.js` files, which means any change forces a full page reload. | Introduce a lightweight bundler (Vite, Rollup, or even esbuild) that can transpile, bundle, serve hot‑module‑reloaded dev builds and run a linter (ESLint). |
| **Hard‑coded strings & magic numbers** | Dates are formatted with `new Date().toLocaleDateString()`, rank is calculated with a magic `3` points per win, truncation uses a bit‑wise hack. | Centralise constants (e.g., `POINTS_PER_WIN = 3`) and replace ad‑hoc truncation with a small utility (`toFixed(4)`). |
| **Inconsistent naming / typos** | `match` vs `matchs`, `parseTournamentList` returns a list of *tournament* objects but the constructor of `Tournament` expects many arguments (yet `new Tournament()` is called with none in the parser). `PlayerResult` references an undefined `draw` variable. | Clean up naming, fix the parser to call `new Tournament(leagueId, name, date, rounds, tops, standings)`, and correct `draw` reference or remove it. |
| **Accessibility / i18n missing** | No ARIA attributes, all text is hard‑coded English, `<button>` elements lack `type="button"` in some places. | Add `role="table"`/`aria‑label`s to custom tables, use a translation file if internationalisation is needed. |
| **Security** – CSP is present but `script-src 'unsafe-inline'` defeats its purpose. Inline event handlers (`onclick`) are still used. | Remove `unsafe-inline`, attach all handlers via JS modules, and keep CSP strict. |
| **Missing documentation** | Only `architecture.md` exists; there is no API doc for the store, no README on how to run the app, no contribution guide. | Add a `README.md` with setup instructions, a `docs/` folder for the data model, and JSDoc comments in the source. |

---

## 3️⃣ What’s currently **missing** (features that the architecture promises but are not implemented)
| Feature (mentioned in `architecture.md`) | Status | What’s needed |
|-------------------------------------------|--------|----------------|
| **Create / delete leagues** | UI navigation only, no data mutation. | Form handling, `store.addLeague()`, `store.deleteLeague(id)`, UI refresh. |
| **Create / delete tournaments within a league** | UI button present, no logic. | `store.addTournament(leagueId, tournament)`, modify league’s `tournament_list`, persist. |
| **CSV import of tournament results** | Input fields exist, no parser. | CSV parsing, validation, conversion to `Match`/`Standing` objects, error UI. |
| **URL import (Spicerack Event)** | Text field & button present, logic missing. | Scrape the given URL (via fetch + DOM parsing or a dedicated API), transform to CSV, feed into the same import pipeline. |
| **Export league / tournament CSV or ZIP** | Not present. | Functions to serialize a league’s tournaments to CSV strings, zip them (JSZip), trigger download. |
| **Player statistics (winrate, deck % etc.)** | Mentioned in docs, no UI or calculation code. | Service that aggregates per‑player stats across all tournaments, a new page/component to display them. |
| **Filtering / sorting of tables** | Table rows are static. | Add column header click handlers that sort `row_list` and re‑render. |
| **Undo / confirmation dialogs for deletes** | None. | Use Bulma modal or native `confirm()` before removing a league/tournament. |
| **Responsive layout for small screens** | Bulma helps but custom tables lack proper overflow handling. | Add CSS `table { overflow‑x:auto; }` or wrap tables in a scrollable container. |
| **Unit / integration tests** | None. | Add test suite (Jest/Vitest) covering parsing, store, CSV import, component rendering. |
| **Build & dev tooling** | Only raw files. | Add a `package.json` with `vite` (or similar) dev server, `npm run build` script, ESLint/Prettier config. |
| **Accessibility** | No ARIA or keyboard focus management. | Add proper roles, labels, focus outlines, ensure all interactive elements are reachable via keyboard. |

---

## 4️⃣ Suggested next steps (prioritised)
1. **Introduce a central store** (`src/store.js`) that abstracts `localStorage` and exposes CRUD functions. Replace every direct `localStorage` call with this store.
2. **Finish the create/delete UI flow** – make `createLeague`, `saveLeague`, `deleteLeague`, `createTournament`, `deleteTournament` functional and persist changes through the store.
3. **Implement CSV import** – add a robust parser (e.g., **PapaParse**), validate column count / types, map rows to `Match` objects, compute standings, and feed the result into the tournament object.
4. **Wire up standing calculations** – a service that, given a tournament’s rounds, builds `Standing` objects; another that aggregates across all tournaments in a league.
5. **Replace dead `CustomTable`** – either delete it or convert `GonesTable` to a Lit‑Element (gives better templating and reactive updates). Ensure the table component receives data via properties instead of a `build()` method (more idiomatic).
6. **Add a simple router** – hash‑based (`#/leagues`, `#/league/123/edit`) that syncs URL → store → page rendering. This removes the need for manual `window.location.href` string building.
7. **Set up a dev/build pipeline** – install `vite` (or `esbuild`), add `npm run dev`, enable hot‑module‑replacement for faster iteration.
8. **Write tests** – start with model parsers (`parseLeague`, `parseTournament`), standing aggregation, and CSV import validation.
9. **Security hardening** – drop `'unsafe-inline'` from CSP, move all listeners to JS modules, and audit any external fetches (CORS, sanitisation).
10. **Documentation** – add a top‑level `README.md` with “How to run”, a short description of the data model, and a contribution guide.

---

### TL;DR
The repository already contains a clean domain model and a reusable table component, but the **application layer is half‑baked**: pages navigate but never mutate data, import/export pipelines are missing, and there is no centralized state or build tooling. By adding a small store, completing the CRUD actions, wiring the CSV import, and introducing a dev build + tests, the codebase will move from a prototype to a maintainable, production‑ready front‑end app.
