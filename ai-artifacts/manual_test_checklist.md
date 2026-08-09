# Manual test checklist — things a human must click that no automated test covers.

## T22 registrations-page-polish

- [ ] Signed in, open the home menu (`/`): a "Mes inscriptions" card appears between the Calendar card and the Settings card, with the description "Consultez les tournois auxquels vous êtes inscrit et annulez une inscription."
- [ ] Click that card: it navigates to `/registrations`.
- [ ] On `/registrations`, a "Retour au menu" button sits above the page title and a second one below the last section; both go back to the home menu.
- [ ] On `/registrations`, there is no "Compte" kicker above the "Mes inscriptions" title.
- [ ] Each registration card still shows its organization name ("Gones") above the tournament title — that kicker must survive.
- [ ] Sign out, open `/`: the "Mes inscriptions" card is gone.
- [ ] Signed out, navigate straight to `/registrations`: you are bounced to `/login`.
- [ ] Switch the app language to English in Settings and reload `/registrations`: the card description and the return buttons read in English, with no missing-key placeholders.
- [ ] At 375px width, `/registrations` has no horizontal scrollbar and both return buttons stay reachable.

## T23 backend-archive-rename

- [ ] After `docker compose run --rm migrator database update`, the existing archived Leagues are all still listed by `curl http://127.0.0.1:5080/api/leagues-archive` — the rename must not have lost a row.
- [ ] `curl http://127.0.0.1:5080/api/leagues` returns 404, and so do `/api/leagues/{id}` and `/api/leagues/{id}/export`: there is no alias for the old paths (ADR 0022).
- [ ] `curl http://127.0.0.1:5080/api/leagues-archive/{id}/tournaments-archive/{tournamentId}` returns the tournament, while the same URL with `/tournaments/` returns 404.
- [ ] Signed in as Organizer, create a League through the UI: the request goes to `/api/leagues-archive` and the `Location` header comes back as `/api/leagues-archive/{id}` (check the browser Network tab).
- [ ] Signed in as Organizer, download a League export and confirm the file still opens with `"kind": "league"` and a `"league"` object — the bundle format is frozen and must not mention "archive".
- [ ] Restore that same downloaded bundle through the restore screen: it is accepted and creates a new League. A bundle exported *before* this change must also still restore.
- [ ] Run a Live Tournament to the end and finalize it as Organizer: the response still carries a `leagueId`, and the finalized tournament shows up inside the target League Archive.
- [ ] Signed in as Organizer, open the player-name maintenance screen and commit a rename: it still works (its `/api/maintenance/player-names*` routes are deliberately not renamed, and its raw SQL now reads `league_archive_aggregates`).
- [ ] Calendar, sign-in/sign-up and the Admin dashboard are all unaffected — spot-check one page of each.
- [ ] Roll back check (optional, destructive — dev stack only): `dotnet ef database update AddTournamentProposals` puts the rows back under `league_aggregates` with no data loss, and re-applying restores them.

## T24 frontend-archive-rename

- [ ] Paste each retired URL into the address bar and press Enter — every one must land on its `-archive` twin with the parameters intact and the page rendered (not the catch-all 404): `/leagues` → `/leagues-archive`; `/leagues/{id}` → `/leagues-archive/{id}`; `/leagues/{id}/tournaments/{tid}` → `/leagues-archive/{id}/tournaments-archive/{tid}`; the same with `/result` and with `/result/metagames`.
- [ ] A real pre-rename bookmark (one saved by the browser before this change, or a `/leagues/...` link in an old email) still opens the right page after the redirect.
- [ ] On the home menu (`/`), the league card reads "Ligues (archive)" in French and "Leagues (archive)" in English, with the description mentioning the archived leagues in both languages and no missing-key placeholder.
- [ ] Clicking that card goes to `/leagues-archive` and the header Import control is visible there — it must not appear on any other page.
- [ ] Breadcrumbs on `/leagues-archive`, `/leagues-archive/{id}` and `/leagues-archive/{id}/tournaments-archive/{tid}` read "Ligues (archive)" / "Ligue (archive)" (and their English equivalents), and every crumb link navigates to an `-archive` URL.
- [ ] Export a League from the archive detail page, then restore that same file through the header Import control: the League comes back complete (tournaments, rounds, entries, standings). A bundle exported *before* this rename must also restore — the bundle format is frozen and its JSON must still say `"kind": "league"`.
- [ ] Export the full data set, wipe local data, restore it: everything comes back and no screen shows a broken `/leagues/...` link.
- [ ] Run a Live Tournament to the end and finalize it as Organizer: the app navigates to `/leagues-archive/{leagueId}/tournaments-archive/{tournamentId}` and the finalized tournament is rendered there.
- [ ] With the browser-local Live store (anonymous or plain user), finalizing still downloads the bundle instead of navigating — the rename must not have turned that into a navigation to an empty league id.
- [ ] Open `/leagues-archive/{id}` directly in a fresh tab (no history) and click the Back button: with no history to pop, it falls back to `/leagues-archive`, never to `/leagues`.
- [ ] Offline check: load `/leagues-archive` and a couple of archive detail pages online, then go offline (DevTools → Network → Offline) and reload them — they still render from the service-worker cache, because the cached API paths are now `/api/leagues-archive*` / `.../tournaments-archive/*`.
- [ ] Still offline, confirm no request to an old `/api/leagues/...` path is attempted (DevTools → Network) — a stale entry there would silently miss the cache.
- [ ] After deploying, a hard reload picks up the new service worker: the old `public-league-reads` cache group is gone and `public-league-archive-reads` is in use (DevTools → Application → Cache Storage).
