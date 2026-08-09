# Plan: Feedback Calendar V1 — Round 2

## Goal

Land the 13-line round-2 feedback on Gones: fix the local-dev 401 (no seeded accounts + `Secure`
refresh cookie over plain HTTP), move the sign-in entry point into the header, reshape the calendar
page (sync row, chrome-less search row, month nav above the grid, empty day cells, list pagination),
add a guarded Live Tournament delete, harden the login form, and give the League Archive a
browser-local store so anonymous visitors can create and manage leagues offline.
Success = every one of the 13 lines shipped, `npm run test && npm run lint && npm run typecheck &&
npm run build && npm run backend:test && npm run cy:run` green, `npm run acceptance:matrix` still proved.

## Scope

- In: `src/**`, `scripts/**`, `compose.yaml`, `package.json`, `cypress/e2e/**`, `ops/**`, `docs/**`, `AGENT.md`, `README.md`.
- In: 2 new ADRs (`docs/adr/0028`, `docs/adr/0029`), 1 new architecture HTML doc, 1 updated.
- Out: `backend/**` C# source. Every backend behaviour this plan needs already exists; only `compose.yaml`
  configuration and a dev-only seeding script change.
- Out: release/production compose files, deployment topology, Docker image contract.
- Out: pushing browser-local leagues to the server. There is no sync path in either direction (ADR 0028).
- Out: retiring or renaming any existing feature.

## Assumptions

- **A1 — artifacts live in `ai-artifacts/`**, ADRs in `docs/adr/` lowercase. Repo `AGENT.md` mandates it and
  `server-authority-boundary.test.ts` / cross-references point there. Overrides the skill's `ai_artefacts/`.
- **A2 — local League parity is total** (user answer). `LocalLeagueArchiveBackend` implements all 22
  `LeagueArchiveBackendPort` methods, not a subset. Anonymous visitors get the whole archive feature offline.
- **A3 — the two League stores are merged, not exclusive** (user answer). Unlike Live (ADR 0021, one adapter
  chosen by role), the League list is the **union** of the server list and the browser-local list. Local rows
  carry a "local only" badge. This is ADR 0028 and it deliberately diverges from ADR 0021.
- **A4 — origin is encoded in the id.** A browser-local league id is `local-<uuid>`; the local placeholder is
  `local-placeholder-league`. `isLocalLeagueId(id)` is the single routing rule for every read and write. No
  schema change to `PersistedLeague`, no extra column, no lookup table.
- **A5 — "the database always prevails"** is implemented as: every command returns the store's own persisted
  document and the caller replaces its in-memory state with that return value. No optimistic local mutation
  is kept when the store disagrees. This is already how both existing adapters behave; T12–T15 keep it.
- **A6 — calendar day cells become empty** (user answer, reconfirmed against the conflict with feedback #6).
  Feedback #9 wins over #6: the month grid renders day numbers only. The fuzzy filter therefore has no
  visible effect on the calendar tab beyond driving its empty state; it filters the list tab. This is a
  deliberate, user-confirmed trade — see T10.
- **A7 — About card width follows a generic rule, not a special case.** `.home-destinations > :last-child:nth-child(odd)`
  spans the row. With the login card removed (feedback #2) an anonymous visitor has 5 cards, so About spans
  the full row for them and is half-width for a signed-in visitor (6 cards). That is the rule as stated.
- **A8 — login password validator is 3 characters, client-side only.** Taken literally from feedback #13.
  The server still enforces its 12-character registration policy; this validator only gates the submit button
  on the **login** form, so a legacy short password is never locked out client-side.
- **A9 — dev accounts are fixed and hardcoded** (user answer): `admin@gones.test` / `test@gones.test`, both
  `Gones-dev-pass-123!`, both email-verified. Admin role is granted by direct SQL, **not** `migrator admin
  bootstrap` — that command consumes a one-shot marker and cannot be re-run for a second address.
- **A10 — the sync icon is inline SVG**, not `<mat-icon>sync</mat-icon>`. The Material Icons font is a remote
  stylesheet (`src/index.html`); the calendar's sync affordance must render for an offline PWA visitor.
- **A11 — list pagination is 20 tournaments per page**, 1-based `page` query parameter, emitted only when > 1,
  reset to 1 whenever the search text, month or view changes.
- **A12 — no new runtime dependency.** Everything is built from what `package.json` already ships.

## Decision records written with this plan

Read the one that covers your ticket **before** coding. They are the specification, not a summary.

| ADR | Covers | Tickets |
| --- | --- | --- |
| [0028 Dual-Source League Archive](../docs/adr/0028-dual-source-league-archive.md) | Server + browser-local League union, id-prefix routing, export merge | T12, T13, T14, T15 |
| [0029 Deterministic Local Development Accounts](../docs/adr/0029-deterministic-local-development-accounts.md) | Seeded dev accounts, refresh-cookie topology for plain HTTP | T1 |

Architecture documents:

| Doc | State | Tickets |
| --- | --- | --- |
| [League Archive Authority](../docs/league-archive-authority.html) | new | T12–T15 |
| [Calendar Data Flow](../docs/calendar-data-flow.html) | updated (page layout + pagination section) | T7–T11 |

## Ticket flowchart

```mermaid
flowchart TD
  T1[T1: dev accounts + refresh cookie] --> T2[T2: header sign-in entry]
  T2 --> T3[T3: home last-card row rule]
  T1 --> T4[T4: delete live tournament]
  T1 --> T5[T5: login oauth + links row]
  T5 --> T6[T6: login validation gate]
  T1 --> T7[T7: calendar sync row]
  T7 --> T8[T8: calendar search row]
  T8 --> T9[T9: month nav above grid]
  T9 --> T10[T10: empty day cells]
  T8 --> T11[T11: list pagination]
  T1 --> T12[T12: local league store core]
  T12 --> T13[T13: local league store parity]
  T13 --> T14[T14: dual-source list + write routing]
  T14 --> T15[T15: dual-source export/import]
```

## Ticket order

| ID | Title | Depends | Commit outcome | File |
| --- | --- | --- | --- | --- |
| T1 | Dev accounts and refresh-cookie topology | — | `npm run dev` yields a working `admin@gones.test` / `test@gones.test` login that survives a reload | `PLAN_2026_08_09_feedback-calendar-v1-round-2/T1_dev-accounts-and-refresh-cookie.md` |
| T2 | Header sign-in entry point | T1 | Signed-out visitors get a Sign in button in the toolbar; the home menu login card is gone | `PLAN_2026_08_09_feedback-calendar-v1-round-2/T2_header-sign-in-entry.md` |
| T3 | Home last-card row rule | T2 | The last home card spans the row only when it would sit alone on it | `PLAN_2026_08_09_feedback-calendar-v1-round-2/T3_home-last-card-row-rule.md` |
| T4 | Delete a running Live Tournament | T1 | Advanced settings ends with a red ghost Delete that asks for confirmation and works on both adapters | `PLAN_2026_08_09_feedback-calendar-v1-round-2/T4_delete-live-tournament.md` |
| T5 | Login OAuth buttons and links row | T1 | "Continue with" + logo, centred; Create account / Forgot password pushed to opposite edges | `PLAN_2026_08_09_feedback-calendar-v1-round-2/T5_login-oauth-and-links-row.md` |
| T6 | Login validation gate | T5 | Submit is grey and disabled until the email is valid and the password is ≥ 3 chars, then turns green | `PLAN_2026_08_09_feedback-calendar-v1-round-2/T6_login-validation-gate.md` |
| T7 | Calendar sync action row | T1 | Sync button with icon and its last-sync stamp sit on the back-to-menu row, top right | `PLAN_2026_08_09_feedback-calendar-v1-round-2/T7_calendar-sync-action-row.md` |
| T8 | Calendar search row | T7 | One chrome-less search input on its own row between the title and the view tabs | `PLAN_2026_08_09_feedback-calendar-v1-round-2/T8_calendar-search-row.md` |
| T9 | Month nav above the grid | T8 | Previous far left, month centred, Next far right, directly above the month grid | `PLAN_2026_08_09_feedback-calendar-v1-round-2/T9_month-nav-above-grid.md` |
| T10 | Empty calendar day cells | T9 | Calendar view renders day numbers only; no tournament entries inside the grid | `PLAN_2026_08_09_feedback-calendar-v1-round-2/T10_empty-calendar-day-cells.md` |
| T11 | List view pagination | T8 | The list tab pages at 20 tournaments and keeps the page in the URL | `PLAN_2026_08_09_feedback-calendar-v1-round-2/T11_list-view-pagination.md` |
| T12 | Local League store — core commands | T1 | `LocalLeagueArchiveBackend` persists leagues in IndexedDB with version-guarded commands | `PLAN_2026_08_09_feedback-calendar-v1-round-2/T12_local-league-store-core.md` |
| T13 | Local League store — full port parity | T12 | All 22 port methods implemented locally and proved against the server-parity fixtures | `PLAN_2026_08_09_feedback-calendar-v1-round-2/T13_local-league-store-parity.md` |
| T14 | Dual-source league list and write routing | T13 | Anonymous visitors create and manage leagues; signed-in users see server + local rows, badged | `PLAN_2026_08_09_feedback-calendar-v1-round-2/T14_dual-source-league-list.md` |
| T15 | Dual-source export and import | T14 | Full data export contains local leagues; import lands in the store the caller may write | `PLAN_2026_08_09_feedback-calendar-v1-round-2/T15_dual-source-export-import.md` |

## Tickets

- [T1: Dev accounts and refresh-cookie topology](PLAN_2026_08_09_feedback-calendar-v1-round-2/T1_dev-accounts-and-refresh-cookie.md) — depends: none
- [T2: Header sign-in entry point](PLAN_2026_08_09_feedback-calendar-v1-round-2/T2_header-sign-in-entry.md) — depends: T1
- [T3: Home last-card row rule](PLAN_2026_08_09_feedback-calendar-v1-round-2/T3_home-last-card-row-rule.md) — depends: T2
- [T4: Delete a running Live Tournament](PLAN_2026_08_09_feedback-calendar-v1-round-2/T4_delete-live-tournament.md) — depends: T1
- [T5: Login OAuth buttons and links row](PLAN_2026_08_09_feedback-calendar-v1-round-2/T5_login-oauth-and-links-row.md) — depends: T1
- [T6: Login validation gate](PLAN_2026_08_09_feedback-calendar-v1-round-2/T6_login-validation-gate.md) — depends: T5
- [T7: Calendar sync action row](PLAN_2026_08_09_feedback-calendar-v1-round-2/T7_calendar-sync-action-row.md) — depends: T1
- [T8: Calendar search row](PLAN_2026_08_09_feedback-calendar-v1-round-2/T8_calendar-search-row.md) — depends: T7
- [T9: Month nav above the grid](PLAN_2026_08_09_feedback-calendar-v1-round-2/T9_month-nav-above-grid.md) — depends: T8
- [T10: Empty calendar day cells](PLAN_2026_08_09_feedback-calendar-v1-round-2/T10_empty-calendar-day-cells.md) — depends: T9
- [T11: List view pagination](PLAN_2026_08_09_feedback-calendar-v1-round-2/T11_list-view-pagination.md) — depends: T8
- [T12: Local League store — core commands](PLAN_2026_08_09_feedback-calendar-v1-round-2/T12_local-league-store-core.md) — depends: T1
- [T13: Local League store — full port parity](PLAN_2026_08_09_feedback-calendar-v1-round-2/T13_local-league-store-parity.md) — depends: T12
- [T14: Dual-source league list and write routing](PLAN_2026_08_09_feedback-calendar-v1-round-2/T14_dual-source-league-list.md) — depends: T13
- [T15: Dual-source export and import](PLAN_2026_08_09_feedback-calendar-v1-round-2/T15_dual-source-export-import.md) — depends: T14

## Feedback line → ticket map

| # | Feedback line | Ticket |
| --- | --- | --- |
| 1 | About card same width as the others, last-row rule | T3 |
| 2 | Sign-in in the header bar, remove the menu card | T2 |
| 3 | Delete the running Live Tournament from advanced settings | T4 |
| 4 | Leagues usable and stored locally when signed out | T12, T13, T14, T15 |
| 5 | Sync button top right with icon, last-sync text to its left | T7 |
| 6 | Fuzzy search on its own row, no label, no border/background | T8 |
| 7 | Pagination over 20 tournaments on the list tab | T11 |
| 8 | Month prev/next above the calendar, left and right | T9 |
| 9 | Remove the tournament list from the calendar view | T10 |
| 10 | 401 on `npm run dev` with the admin and test accounts | T1 |
| 11 | "Continue with" + platform logo, centred | T5 |
| 12 | Create account / Forgot password justified apart | T5 |
| 13 | Email and password validators gating a grey → green submit | T6 |
