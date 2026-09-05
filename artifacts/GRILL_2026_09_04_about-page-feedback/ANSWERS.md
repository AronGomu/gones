# Grill: About page feedback

## Facts (scout)

- F1. Feedback has 35 numbered About reqs under mismatched `Create/Edit Event Page` heading — source: `feedback.md:1-41`.
- F2. Shell owns toolbar + breadcrumbs; About owns internal nav + top/bottom back btns — source: `src/app/app.component.ts:30-84`, `src/app/features/menu/about.component.ts:86-94`, `src/app/features/menu/about.component.ts:387`.
- F3. Removing About top back btn requires explicit ADR 0044 exception + executable coverage update — source: `docs/adr/0044-back-button-below-breadcrumb-root.md`, `src/app/shared/back-button-coverage.test.ts:49-65`.
- F4. Upcoming selector currently keeps all future Events, sorts, caps 3; no Organization filter — source: `src/app/features/menu/about-upcoming-events.ts:1-14`.
- F5. About catalog read already uses 24h cache + manual forced sync — source: `src/app/features/menu/about.component.ts:335-373`, `docs/adr/0039-ttl-cache-contract.md`.
- F6. Requested seven fixed images exist. Dimensions verified with `identify`: hero `2048x1152`; weekly `2048x1536`; association `2048x1536`; leagues `2048x1152`; Fire `2048x1152`; promo `2048x1366`; Ice `2048x1536`.
- F7. Frontend requires all translatable copy in both `en` + `fr` maps — source: `src/AGENT.md:11-13`.
- F8. Canonical Calendar route is `/events`; `/calendar` alias is retired — source: `docs/adr/0038-event-routes-without-calendar-aliases.md`.
- F9. Required GPT-5.6 Luna scout unavailable: provider returned `No API key found for openai.` Default fresh read-only scout supplied facts instead.
- F10. Backend emits Event image URLs as root-relative `/api/event-images/{id}/variants/{width}` paths — source: `backend/src/Gones.Api/Events/PublicEventEndpoints.cs:504-511`.
- F11. Native `<img>` receives URLs unchanged while dev SPA/API use `127.0.0.1:4200`/`127.0.0.1:5080`; Angular dev server has no API proxy — source: `src/app/features/events/event-detail-view.component.ts:54-59`, `src/environments/environment.ts:1-14`, `angular.json:45-61`.
- F12. `event-detail-fact-date-viewer` is one conditional `<p>` in shared Event detail view — source: `src/app/features/events/event-detail-view.component.ts:47`.
- F13. Event img fix must preserve `blob:` preview URLs because Event create/edit preview reuses shared detail component — source: `docs/adr/0054-direct-event-publication-with-live-local-preview.md:18-47`.

## Round 1 — About page contracts

| # | Question | Answer | Precision |
| --- | --- | --- | --- |
| 1 | Does this feedback change only the About page? | About page only | — |
| 2 | What does temporary borderless `about-next-up` version mean? | Render borderless clone immediately above bordered original | — |
| 3 | How should revised hero lede split across lines? | Two paragraphs with supplied English copy | — |
| 4 | Where should “Find all Events” appear with dynamic rows? | After entire dynamic list | — |
| 5 | Which stable Organization identity defines MTGones Events? | Filter by exact Organization ID | Will be supplied later |
| 6 | What exact Fire & Ice body should ship? | Use polished copy | — |
| 7 | How should new copy be localized into French? | Use English copy in both locale maps | French supplied later |
| 8 | How should About toolbar nav behave on narrow screens? | Collapse links into menu btn | — |
| 9 | How full-width should `about-hero-image` become? | Viewport-wide directly under toolbar | — |

## Added scope — Event detail

- S1. Fix manually observed Event image load failure.
- S2. Remove `event-detail-fact-date-viewer` line.

## Round 2 — Integration contracts

| # | Question | Answer | Precision |
| --- | --- | --- | --- |
| 1 | How interactive should temporary borderless Next Up clone be? | Full live clone with unique IDs and controls | — |
| 2 | How should plan handle MTGones Organization ID arriving later? | Create blocked frontload ticket for exact ID | — |
| 3 | What exact narrow About toolbar menu should ship? | `Sections` text btn at `760px` | — |
| 4 | Which Event image URL repair contract should plan use? | Resolve API-relative image paths in frontend | — |

## Shared understanding

- U1. Spec lvl: 5 — target reached for current scope; exact MTGones filtering is deferred.
- U2. Goal: apply `feedback.md` About reqs 1-35 plus Event detail img bug fix + viewer-date row removal.
- U3. About scope: `/about`; Event scope: shared Event detail view used by public detail + create/edit live preview.
- U4. Shell: move About section nav into `.app-toolbar`; center it in space between brand + auth actions. Hide `.breadcrumb-shell` on `/about`.
- U5. Back nav: remove About top `gones-back-button`; keep bottom btn. Supersede ADR 0044 with explicit `/about` exception + update executable coverage.
- U6. Toolbar desktop: direct links in order Association → Tournaments → Staff → Calendar. Targets `#association`, `#tournaments`, `#staff`, `/events`.
- U7. Toolbar narrow: at `max-width: 760px`, hide direct links; show Material text btn `Sections`; menu items preserve U6 order/targets. Add exact `data-cy` attrs per `src/AGENT.md`.
- U8. Hero: viewport-wide, directly below toolbar, no breadcrumb/nav/back gap, no red border, no side gutters. Image `src="assets/images/in-use/2025-01-ice-mtgones-10-years.jpeg"`; fill box with `width:100%`, `height:100%`, `object-fit:cover`; no distortion.
- U9. Hero title EN: render exactly two visual lines: `Legacy is played` / `in Lyon`.
- U10. Remove hero kicker row, `about-hero-calendar-link`, `about-hero-team-link`, plus now-empty action wrapper.
- U11. Hero lede uses two `<p>` nodes. EN line 1: `MTGones brings Magic enthusiasts together around welcoming but challenging and memorable tournaments.` EN line 2: `Play at weekly Thursday meetups to major Fire & Ice weekends.`
- U12. New/revised EN copy is temporarily copied verbatim into both `en` + `fr` maps. User supplies French later; no translation work in this plan.
- U13. Next Up renders two full live sections: borderless clone immediately above bordered original. Both expose unique heading IDs + `data-cy` values; both show title/sync bar/promo img/loading/error/empty/top-3 rows/CTA; both share one fetched state + one force-sync behavior.
- U14. Remove Next Up kicker row. Each title + `gones-sync-bar` shares one heading row.
- U15. Each Next Up variant places `assets/images/in-use/2025-01-damnation-fest-pisa-mtgones-bougnat-01.jpeg` directly below title/sync row.
- U16. Each non-error Next Up rendering places `Find all Events` CTA after whole dynamic list; route `/events`. Existing error/empty Calendar recovery links remain.
- U17. Current Upcoming selector contract remains `selectUpcomingEvents(items, now)`: all Organizations, valid starts strictly after `now`, existing `sortEventsForList` ordering, first 3, no input mutation.
- U18. Deferred T1 later obtains exact MTGones Organization ID and adds exact filter. It does not block current About implementation.
- U19. Remove association/tournaments/staff kickers + their rows; retain titles/bodies.
- U20. Static image refs move into `src/assets/images/in-use/`: hero, weekly, association, leagues, Fire, promo, Ice. Update source + tests; no unrelated img moves.
- U21. Weekly image: `2017-gones-legacy-trollune.jpeg`. Association image: `2025-07-last-trollune.jpeg`. Leagues image: `2023-08-elm-qualifier-trollune.jpeg`. Fire image: `2024-07-cdf-legacy-vaugneray-original.jpeg`. Ice image: `2026-01-ice-01.jpeg`.
- U22. Fire + Ice imgs each fill own half with crop, no distortion: `width:100%`, shared equal visual box, `object-fit:cover`.
- U23. Remove weekly/monthly/salty/leagues Calendar btns + orphaned `actionKey` metadata/message refs created obsolete by removal.
- U24. Weekly metadata: Field `4 round swiss`; Where `Card'Era, Lyon`.
- U25. Monthly metadata: Field `5 round swiss + top 8`; When `First sunday of the month`; Where `Arcaneum, Lyon`.
- U26. Salty metadata: Field `5-7 round swiss + top 8`; Where `Lyon`.
- U27. Fire & Ice title uses full available width; wraps only when viewport lacks space.
- U28. Fire & Ice EN body: `One major each season: Fire in summer and Ice in winter. Play a full weekend of Magic tournaments and events in Eternal formats. Legacy is the main event, but you can also enjoy Pauper, Premodern, and even Vintage. We start Friday afternoon and finish Sunday!`
- U29. Leagues EN body: `Every weekly and monthly tournament earns you league points. At the end of the season, the 16 players with the most points qualify for the League Final to play for crazy prizes !`
- U30. Event img helper contract: `resolveApiAssetUrl(url: string, apiBaseUrl: string): string`. Empty input stays empty. `/api/**` joins normalized `dataAuthority().apiBaseUrl`. `blob:`, `data:`, absolute `http://`/`https://` stay unchanged. Apply helper to fallback `src` + every `srcset` variant URL.
- U31. Event img wire/API/storage contracts stay unchanged: private object store, API-streamed variant endpoints, relative URL response shape. No same-origin proxy or CSP expansion.
- U32. Remove entire conditional `<p data-cy="event-detail-fact-date-viewer">…</p>` from shared Event detail view. Remove only code/tests made orphaned by this change.
- U33. TDD required per ticket: failing focused test first, min green impl, refactor only while green.

## Assumptions

- A1. `tournaments` in feedback item 23 means Calendar Events per ADR 0035.
- A2. Existing future/date validity + `sortEventsForList` order remain unchanged except exact Organization filter.
- A3. Both Next Up variants intentionally duplicate accessible interactive content temporarily.
- A4. Event img manual failure stems from source-proven SPA/API origin mismatch; ticket still captures browser HTTP evidence before repair.
- A5. Fixed English strings preserve user capitalization/spelling except Fire & Ice body uses selected polished copy.

## Post-confirmation override

- X1. User deferred exact MTGones Organization filtering until much later.
- X2. Current About work keeps existing all-Organization top-3 selector behavior.
- X3. Deferred T1 later obtains exact ID + adds filter; it does not block current T2–T5 flow.

## Out of scope

- O1. Create/Edit Event behavior beyond shared preview img rendering.
- O2. Backend Event image response/storage redesign.
- O3. French translation authoring.
- O4. Deleting either temporary Next Up variant.
- O5. Moving unrelated About staff/avatar imgs.
