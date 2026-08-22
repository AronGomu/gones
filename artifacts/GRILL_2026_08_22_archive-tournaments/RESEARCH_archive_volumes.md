# Research: realistic lifetime data volumes for an MTG tournament results archive

Date of measurement: 2026-08-22. All id probes below were executed live against the sites on that date.

## Summary

The largest MTG-specific public tournament archive, **mtgtop8.com**, has emitted roughly **90,000 event ids** over ~19 years of operation (archive content back-filled to **1994-08-01**), carrying roughly **880,000 decklists** at ~8.7 archived decklists per event. Its intake rate is **accelerating, not linear**: ~190 events/yr in 2009, ~3,200/yr in 2019, ~17,300/yr annualised in 2026. Applying the requested 2× headroom to that figure gives a ceiling of **180,000 rows** — which does **not** fit `localStorage`: at 180 bytes/row serialized and UTF-16 storage, a full 5 MiB quota holds only **~14,563 rows**, so 180,000 rows overshoots by ~12.4×.

## Summary table

| Site | First archived event | Total tournaments/events | Total decklists/entries | Distinct series ("group" tier) | Tournaments/yr (recent) | Players/tournament typical | Confidence | Source |
|---|---|---|---|---|---|---|---|---|
| mtgtop8.com | 1994-08-01 (Worlds 1994, back-filled) | **≤ 89,865** (highest observed event id) | **≤ ~882,000** (highest observed deck id `d=881984`) | not published; site exposes 13 format tabs + `meta` ids up to **341** | **~17,300/yr** (annualised Dec-2025→Aug-2026) | 8–16 archived decklists/event; attendance field 60–96 on sampled events | High (id ceiling), Med (yearly rate) | [e=89865](https://www.mtgtop8.com/event?e=89865&f=ST), [Worlds history](https://www.mtgtop8.com/format?f=ST&meta=97&cp=2) |
| Grand Prix (as a *series*, all-time) | 1997-03-22 (Amsterdam) | **702** total GPs ever held | n/a | 1 series | 50–60/yr at peak, 20–30/yr in the 1990s; **0** since 2020 | max **7,551** (GP Las Vegas 2015) | High | [Wikipedia: Grand Prix (MTG)](https://en.wikipedia.org/wiki/Grand_Prix_(Magic:_The_Gathering)) |
| Pro Tour (as a *series*, all-time) | 1996-02-16 (New York) | ~3–7 events/season since 1996 → order of **130–150** all-time | mtgtop8 holds **1,998** Standard PT decklists alone | 1 series | 3–4/yr | 300–500 | High (structure), Med (exact total) | [Wikipedia: Players Tour](https://en.wikipedia.org/wiki/Magic:_The_Gathering_Pro_Tour), [mtgtop8 meta=91](https://www.mtgtop8.com/format?f=ST&meta=91) |
| World Championship | 1994-08-01 | **32** editions (1994→2025, sampled continuous) | 740 Standard decklists on mtgtop8 | 1 series | 1/yr | 16–128 | High | [mtgtop8 meta=97](https://www.mtgtop8.com/format?f=ST&meta=97&cp=2) |
| melee.gg (TO platform, **multi-TCG**) | not found | **~290,000–300,000** tournament ids (id 290000 resolves, 300000 returns `Error Code: 404 - Tournament not found`) | not found | n/a — organiser-created, no series tier exposed publicly | not found | not found | Med (id ceiling), Low (MTG share) | [id 290000](https://melee.gg/Tournament/View/290000), [id 300000](https://melee.gg/Tournament/View/300000) |
| mtggoldfish.com | 2012 (site copyright `© 2012-2026`) | **not found** — tournament URLs are slugs, not numeric ids; no published count | not found | not found | not found | not found | Low | [tournament search](https://www.mtggoldfish.com/tournament_searches/create) |
| mtgdecks.net | not found | not found (HTTP 403 to fetcher) | not found | not found | not found | not found | — | — |
| topdeck.gg | not found | not found (JS-rendered, no public count) | not found | not found | not found | not found | — | [topdeck.gg](https://topdeck.gg/) |
| Liquipedia MTG | n/a | **does not exist** — `liquipedia.net/magicthegathering/*` returns HTTP 404 | — | — | — | — | High (negative) | HTTP 404 observed |

## How I derived each number

### mtgtop8.com — the governing case

**Total events (hard ceiling, id probe).** The Standard format front page listed the newest event as `MTGO Challenge 32` at `event?e=89865`, dated `21/08/26` — one day before measurement. Fetching that id confirms a live event page. So the site has issued **89,865 event ids** total. Caveat, stated plainly: a handful of those ids are editorial, not tournaments — e.g. `e=88980` is `The Decks to Beat - July '26` and `e=89150` is `The Rogue Corner - August '26`. The id count is therefore a genuine **upper bound** on tournaments, and I treat ~90,000 as the working figure.
- [https://www.mtgtop8.com/event?e=89865&f=ST](https://www.mtgtop8.com/event?e=89865&f=ST)
- [https://www.mtgtop8.com/format?f=ST](https://www.mtgtop8.com/format?f=ST)

**Total decklists (hard ceiling, id probe).** Deck ids are a separate sequence, visible in the `d=` parameter on each event page.
- `e=1` (2007-06-24) carries deck ids `d=101680` … `d=101688`.
- `e=100` (2007-11-17) carries `d=107526` … `d=107534`.
- `e=89865` (2026-08-21) carries `d=881969` … `d=881984`.

Highest observed deck id = **881,984**. The sequence starts above 100,000 (mtgtop8 evidently renumbered at some point), so lifetime decklists ≈ 881,984 − 101,680 ≈ **780,000** — call it 0.8–0.9 M. *Estimate, derived:* decklists per event = 780,304 ÷ 89,864 ≈ **8.68**. That matches the site's editorial model — it archives the Top 8 of most events, plus deeper cuts (16 rows) for MTGO Challenges.

**Site age / first archived event.** The oldest archived event I could observe is `Worlds 1994 (Milwaukee)`, `e=9186`, dated `01/08/94`. Its id (9186) is far above the ids of 2007-era events (`e=1`, `e=100`), which proves it was **back-filled**, not contemporaneous. The site's own id sequence starts in **2007** (`e=1` = `Coupe de France Vintage`, `24/06/07`). So: coverage since **1994**, operation since **2007**.
- [https://www.mtgtop8.com/format?f=ST&meta=97&cp=2](https://www.mtgtop8.com/format?f=ST&meta=97&cp=2)
- [https://www.mtgtop8.com/event?e=1&f=ST](https://www.mtgtop8.com/event?e=1&f=ST)

**Growth curve (estimate, derived from id/date anchors).** Every pair below is a directly observed `event?e=N` page with a printed date. Rate = Δid ÷ Δtime, annualised.

| Anchor A (id, date) | Anchor B (id, date) | Δid | Span | Events/yr |
|---|---|---|---|---|
| 396, 14/12/08 | 770, 12/12/10 | 374 | 24 mo | **187** |
| 770, 12/12/10 | 2245, 20/11/11 | 1,475 | 11.3 mo | **1,570** |
| 8671, 03/12/14 | 11093, 13/12/15 | 2,422 | 12.3 mo | **2,360** |
| 20758, 16/12/18 | 23942, 06/12/19 | 3,184 | 11.7 mo | **3,270** |
| 23942, 06/12/19 | 27955, 01/11/20 | 4,013 | 10.9 mo | **4,420** |
| 32656, 05/10/21 | 39128, 28/10/22 | 6,472 | 12.8 mo | **6,070** |
| 39128, 28/10/22 | 60938, 24/10/24 | 21,810 | 24.0 mo | **10,905** |
| 77460, 05/12/25 | 89865, 21/08/26 | 12,405 | 8.5 mo | **17,510** |

The curve is unambiguously **accelerating** — roughly 2× every 4 years since 2014, and steeper since 2022 (RCQ system + MTGO Challenge/League volume + melee.gg-sourced paper results). It is not linear and not flat.

*Estimate, derived:* if 2026 runs ~17,500 events and grows 15 %/yr, five more years adds 17,500 × (1.15 + 1.15² + … + 1.15⁵) ≈ 17,500 × 6.74 ≈ 118,000, putting mtgtop8 near **208,000 events by 2031**. This is the sanity check on the ceiling: 2× today's 90,000 = 180,000 buys roughly **4–5 years** of mtgtop8-rate growth, not a decade.

**Players per tournament.** mtgtop8 prints an attendance figure on event pages where it has one:
- `e=100` `# Danish Legacy Champs 2007` — **96 players**, 8 decklists archived.
- `e=89865` `MTGO Challenge 32` — **60 players**, 16 decklists archived.

Typical archived-event attendance sits in the tens-to-low-hundreds; the extreme high end for MTG paper is **7,551** at GP Las Vegas 2015 ([Wikipedia](https://en.wikipedia.org/wiki/Grand_Prix_(Magic:_The_Gathering))). Critically for row sizing: **rows archived per tournament ≈ 8–16**, not the attendance number.

**Series / group tier.** mtgtop8 does not publish a series count. Two observable proxies: **13 format tabs** (Standard, Pioneer, Modern, Legacy, Vintage, Arena, Pauper, cEDH, Duel Commander, Premodern, Limited, Other, Search), and internal `meta` bucket ids running to **341** (`?f=ST&meta=341` = "All 2026 Decks"), of which only ~24 are surfaced per format. Real-world MTG series that a Gones-style "league" tier would model — Pro Tour, Worlds, Grand Prix, Nationals, RCQ, MTGO Challenge, MTGO League, Magic Spotlight Series, national circuits — number in the **low hundreds at most**, i.e. three orders of magnitude below the tournament count. The group tier is not a sizing risk.

### Grand Prix — the only clean lifetime series count

> "Until their cancellation, 702 Grand Prix events were held, the biggest being GP Las Vegas 2015 with 7,551 competitors" — [Wikipedia: Grand Prix (Magic: The Gathering)](https://en.wikipedia.org/wiki/Grand_Prix_(Magic:_The_Gathering))

First GP: **1997-03-22, Amsterdam**. Cadence: "20 to 30 events per year in the 1990s growing to 50-60 events per year towards the end". Cancelled 2020; successor **Magic Spotlight Series** announced 2024-08-20. This is the best-documented single series in MTG and it totals **702 rows over 23 years** — useful calibration: a flagship worldwide circuit contributes under a thousand rows across its entire life.

### Pro Tour / Worlds

Wikipedia documents the structure but not a lifetime count: first PT 1996-02-16 New York; "five and later six Pro Tours" per season through the early 2000s, seven in '03-'04 and '04-'05, "reduced to five and later four", three per season from 2012, back to four in 2014. *Estimate, derived:* ~30 seasons × ~4.5 events ≈ **135 Pro Tour-tier events all-time**. mtgtop8's `History - All Pro Tour` Standard bucket holds **1,998 decks** and `History - All Worlds` holds **740 decks** — decklist counts, not event counts, and Standard-only.
- [https://www.mtgtop8.com/format?f=ST&meta=91](https://www.mtgtop8.com/format?f=ST&meta=91)
- [https://www.mtgtop8.com/format?f=ST&meta=97](https://www.mtgtop8.com/format?f=ST&meta=97)

Worlds editions observable on mtgtop8 run **1994 → 2025** unbroken in the listing: 1994 (`e=9186`), 1995, 1996, 1997, 1998, 1999, 2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007 (`e=117`), 2008 (`e=396`), 2009 (`e=443`), 2010 (`e=770`), 2011 (`e=2245`), 2012 WMC (`e=2818`), 2013 (`e=5383`), 2014 (`e=8671`), 2015 (`e=10387`), 2016 (`e=13406`), 2017 (`e=17119`), 2018 (`e=20145`), 2019 (`e=23942`), 2020 (`e=24631`), 2021 (`e=32656`), 2022 (`e=39128`), 2023 (`e=48012`), 2024 (`e=60938`), 2025 (`e=77460`) → **~32 events**.

### melee.gg — bounded by binary id search, but not comparable

Sequential probe of `https://melee.gg/Tournament/View/<id>`:

| id | result |
|---|---|
| 100000 | `Tournoi Ligue S4` (Lorcana) — exists |
| 200000 | `Starwars Unlimited Weekly` — exists |
| 250000 | `Jump to Lightspeed Sealed` — exists |
| 280000 | `Star Wars Unlimited Local` — exists |
| 290000 | `Sunday Lorcana League` — exists |
| 300000 | `Error Code: 404 - Tournament not found` |

Max id lies between **290,000 and 300,000**. **I am deliberately not using this as the sizing anchor**, and the reason is visible in the data above: three of five sampled ids are Lorcana or Star Wars Unlimited, not Magic. melee.gg is a general TCG tournament-organiser platform whose row population is dominated by tiny weekly store events across many games. It is not an MTG results *archive* comparable to Gones, so treating ~295,000 as "the largest credible total-tournament figure" would import a non-comparable population. mtgtop8's ~90,000 is the correct comparable.

### Sites where the number was not obtainable

- **mtggoldfish.com** — tournament pages use text slugs (`/tournament/<slug>`), not integer ids, so no id-range probe is possible. `/tournaments` is 404; `/tournament_searches?commit=Search` is 404; `/tournament/78000` is 404. The search form at `/tournament_searches/create` renders no result count server-side. No "X decks in database" counter is published. `robots.txt` explicitly `Disallow: /` for `ClaudeBot`, `GPTBot`, `CCBot` and others, and sets `Content-Signal: ai-train=no`. **Not found.**
- **mtgdecks.net** — HTTP 403 to the fetcher on `/tournaments`. **Not found.**
- **topdeck.gg** — homepage is a JS shell with no counters in server HTML. **Not found.**
- **Liquipedia MTG** — `liquipedia.net/magicthegathering/Main_Page` and `/Portal:Tournaments` both return **HTTP 404**. Liquipedia has no Magic: The Gathering wiki. Drop this target.
- **deckstats.net, aetherhub.com, Wizards event coverage, limitless** — not probed; the mtgtop8 ceiling already dominates and none of these is plausibly an order of magnitude larger as an MTG results archive.

## Recommended ceiling for Gones

**Step 1 — largest credible total-tournament figure.** mtgtop8: **89,865** observed event ids → round to **90,000**. (melee.gg's ~295,000 is excluded as non-comparable; see above.)

**Step 2 — apply the requested 2× headroom.**

```
90,000 × 2 = 180,000 rows
```

**Step 3 — implied payload at 180 bytes/row.**

```
JSON text:            180,000 rows × 180 B/row = 32,400,000 B  ≈ 32.4 MB  (30.9 MiB)
localStorage UTF-16:  32,400,000 chars × 2 B    = 64,800,000 B ≈ 64.8 MB  (61.8 MiB)
```

**Step 4 — does it fit a ~5 MB quota? No. Not remotely.**

A 180,000-row catalog needs **~62 MiB** of `localStorage` budget. Against a 5 MiB quota it overshoots by **12.4×**, and that is before any other cache shares the origin's quota. This is not a tuning problem; the whole-catalog-in-`localStorage` design breaks well before the archive reaches comparable-site scale.

**Where it stops fitting** (180 B/row, UTF-16 at 2 B/char, `localStorage` `QuotaExceededError` on write):

| Share of a 5 MiB origin quota | Bytes available | Chars | **Max rows** |
|---|---|---|---|
| 100 % (catalog is the only cache) | 5,242,880 | 2,621,440 | **14,563** |
| 100 %, decimal 5 MB reading | 5,000,000 | 2,500,000 | **13,888** |
| 50 % (shared with other caches) | 2,621,440 | 1,310,720 | **7,281** |
| 25 % (conservative, several caches) | 1,310,720 | 655,360 | **3,640** |

So: the catalog stops fitting at roughly **14,500 rows** if it owns the entire quota, and at roughly **7,300 rows** on the realistic assumption that it shares the origin with other caches. Both are far below 180,000 and below even a single year of mtgtop8's current 17,500 events/yr intake.

**Consequence to flag before implementation:** 180,000 rows is a defensible *archive* ceiling — it is 2× the largest real MTG archive and buys ~4–5 years at mtgtop8's accelerating rate. It is not a defensible *`localStorage`* ceiling. If the 180,000 ceiling is kept, the client cache must move to IndexedDB (no ~5 MB cap, stores structured clones rather than UTF-16 strings) or the Archive page must page server-side. If `localStorage` is kept, the honest cap is ~7,000 rows, which is ~5 months of mtgtop8-rate growth and will be hit by any archive of real ambition.

### One-line answer

**180,000** — the row ceiling per the 2× rule (2 × mtgtop8's ~90,000 lifetime events); note it needs ~62 MiB in `localStorage` and therefore requires IndexedDB or server-side paging, since a 5 MiB `localStorage` quota caps the catalog at ~14,500 rows unshared / ~7,300 rows shared.

## Sources

**Kept**
- mtgtop8 Standard format page — https://www.mtgtop8.com/format?f=ST — surfaced the newest event id `e=89865` on 21/08/26, the ceiling that drives the whole estimate.
- mtgtop8 event `e=89865` — https://www.mtgtop8.com/event?e=89865&f=ST — confirms the id resolves; gives attendance (60 players) and highest deck id `d=881984`.
- mtgtop8 event `e=1` — https://www.mtgtop8.com/event?e=1&f=ST — first id in the sequence, dated 24/06/07; anchors site operating age and deck-id sequence start.
- mtgtop8 event `e=100` — https://www.mtgtop8.com/event?e=100&f=ST — second early anchor, prints "96 players".
- mtgtop8 Worlds history pp. 1–2 — https://www.mtgtop8.com/format?f=ST&meta=97 and `&cp=2` — 32 Worlds editions, oldest archived event 01/08/94, plus ~18 id/date anchors for the growth curve.
- mtgtop8 Pro Tour history — https://www.mtgtop8.com/format?f=ST&meta=91 — 1,998 PT Standard decks + PT id/date anchors 2017→2026.
- mtgtop8 Grand Prix history — https://www.mtgtop8.com/format?f=ST&meta=96 — 1,293 GP Standard decks; confirms GP coverage stops 07/03/20.
- Wikipedia, Grand Prix (Magic: The Gathering) — https://en.wikipedia.org/wiki/Grand_Prix_(Magic:_The_Gathering) — the only clean lifetime series count: 702 GPs, first 1997-03-22, max attendance 7,551.
- Wikipedia, Players Tour / Pro Tour — https://en.wikipedia.org/wiki/Magic:_The_Gathering_Pro_Tour — PT cadence per season since 1996, first event 1996-02-16.
- melee.gg id probes 100000 / 200000 / 250000 / 280000 / 290000 / 300000 — bounds max tournament id at 290k–300k; also demonstrates the multi-TCG mix that disqualifies it as the anchor.

**Dropped**
- Liquipedia MTG — no such wiki; `/magicthegathering/*` returns HTTP 404.
- mtgdecks.net — HTTP 403, no data obtainable.
- mtggoldfish.com tournament index — slug-based URLs, no numeric id sequence, no published count, `robots.txt` disallows this class of agent.
- topdeck.gg — JS-only shell, no server-rendered counts.
- deckstats.net / aetherhub.com / limitless / Wizards event coverage — not probed; cannot plausibly exceed mtgtop8 as an MTG results archive, so they cannot move the ceiling.

## Gaps

1. **mtgtop8 id sparsity is unquantified.** I proved ids run to 89,865 and that at least two are editorial articles, but I did not sample to measure what fraction of the range is tournaments vs. articles vs. deleted. 90,000 is an upper bound; the true tournament count could be 5–15 % lower. *Next step:* probe ~200 ids sampled uniformly across `[1, 89865]` and count how many render a tournament (attendance line + `d=` list) vs. an article vs. 404.
2. **MTGGoldfish is a genuine blank.** It is arguably the closest commercial comparable and I could not extract a single count from it. *Next step:* fetch `https://www.mtggoldfish.com/tournament_searches/new?mformat=standard`, submit the search form and read the pagination footer (`Page 1 of N`) for a row total, or count `<url>` entries in its sitemap if one is reachable.
3. **melee.gg's MTG share is unknown.** 290k–300k total ids, but the MTG fraction was not measured. *Next step:* sample 50 ids and classify by game to get an MTG proportion; that would give a second, independent MTG-tournament-count anchor.
4. **Per-row byte figure is an input, not a finding.** The 180 B/row was supplied in the task, not measured against the Gones catalog schema. The quota arithmetic scales linearly, so if the real serialized row is 250 B the fitting row count drops to ~10,500 (unshared) / ~5,200 (half-quota). *Next step:* `JSON.stringify` one real catalog row and measure `.length` before locking the cap.
5. **`localStorage` quota is assumed at ~5 MiB.** Actual per-origin quota varies by browser (Chrome/Firefox ~5 MiB per origin for `localStorage` specifically; Safari differs and evicts). Not verified against target browsers. *Next step:* run an incremental-write probe in each supported browser to find the real ceiling before shipping.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Brief written to /home/aron/projects/gones/.pi-subagents/artifacts/outputs/087f580e-d68f-4586-b1b5-f7ef237068ed/artifacts/GRILL_2026_08_22_archive-tournaments/RESEARCH_archive_volumes.md with per-site summary table, per-site derivation section, live id-probe evidence (mtgtop8 max event id 89865, max deck id 881984, 18+ id/date growth anchors; melee.gg max id bracketed 290000-300000), one hard external count (702 Grand Prix, Wikipedia), explicit localStorage arithmetic, and a single-integer cap answer."
    }
  ],
  "changedFiles": [
    ".pi-subagents/artifacts/outputs/087f580e-d68f-4586-b1b5-f7ef237068ed/artifacts/GRILL_2026_08_22_archive-tournaments/RESEARCH_archive_volumes.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "fetch_content https://www.mtgtop8.com/format?f=ST",
      "result": "passed",
      "summary": "Newest event id e=89865 dated 21/08/26 observed on Standard front page"
    },
    {
      "command": "fetch_content https://www.mtgtop8.com/event?e=89865&f=ST",
      "result": "passed",
      "summary": "Resolves; 60 players; deck ids d=881969..881984"
    },
    {
      "command": "fetch_content https://www.mtgtop8.com/event?e=1&f=ST",
      "result": "passed",
      "summary": "Coupe de France Vintage, 24/06/07, deck ids d=101680..101688"
    },
    {
      "command": "fetch_content https://www.mtgtop8.com/format?f=ST&meta=97&cp=2",
      "result": "passed",
      "summary": "Worlds 1994 e=9186 dated 01/08/94 = oldest archived event; 32 Worlds editions; supplies growth anchors"
    },
    {
      "command": "fetch_content https://en.wikipedia.org/wiki/Grand_Prix_(Magic:_The_Gathering)",
      "result": "passed",
      "summary": "702 Grand Prix all-time, first 1997-03-22, max 7551 players GP Las Vegas 2015"
    },
    {
      "command": "fetch_content https://melee.gg/Tournament/View/{100000,200000,250000,280000,290000,300000}",
      "result": "passed",
      "summary": "290000 resolves, 300000 returns 'Error Code: 404 - Tournament not found' -> max id in 290k-300k; sampled titles show Lorcana/SWU dominance"
    },
    {
      "command": "web_search (4 queries x2 batches)",
      "result": "failed",
      "summary": "Gemini API error: 'models/gemini-2.5-flash-lite is no longer available to new users' on all 8 queries; fell back entirely to direct primary-source fetches"
    },
    {
      "command": "fetch_content https://www.mtggoldfish.com/{tournaments,tournament/78000,tournament_searches?commit=Search}",
      "result": "failed",
      "summary": "All HTTP 404; no numeric id sequence and no published count -> reported as 'not found'"
    },
    {
      "command": "fetch_content https://mtgdecks.net/tournaments",
      "result": "failed",
      "summary": "HTTP 403 -> reported as 'not found'"
    },
    {
      "command": "fetch_content https://liquipedia.net/magicthegathering/{Main_Page,Portal:Tournaments}",
      "result": "failed",
      "summary": "Both HTTP 404 -> no MTG Liquipedia wiki exists; target dropped"
    }
  ],
  "validationOutput": [
    "Anchor set for growth curve (all directly observed event?e= pages with printed dates): 9186=01/08/94, 1=24/06/07, 117=06/12/07, 396=14/12/08, 443=19/11/09, 770=12/12/10, 2245=20/11/11, 2818=18/08/12, 5383=01/08/13, 8671=03/12/14, 10387=30/08/15, 11093=13/12/15, 13406=02/09/16, 17119=07/10/17, 20145=23/09/18, 23942=06/12/19, 27955=01/11/20, 32656=05/10/21, 39128=28/10/22, 48012=22/09/23, 60938=24/10/24, 77460=05/12/25, 84341=01/05/26, 89865=21/08/26",
    "Derived intake rates: 187/yr (2008-2010), 1570/yr (2010-2011), 2360/yr (2014-2015), 3270/yr (2018-2019), 4420/yr (2019-2020), 6070/yr (2021-2022), 10905/yr (2022-2024), 17510/yr annualised (Dec2025-Aug2026) -> accelerating",
    "Decklists/event = (881984 - 101680) / (89865 - 1) = 780304 / 89864 = 8.68",
    "Ceiling: 90000 x 2 = 180000 rows; 180000 x 180 B = 32,400,000 B JSON; x2 for UTF-16 = 64,800,000 B ~= 61.8 MiB",
    "Fit: 5 MiB = 5,242,880 B / 2 = 2,621,440 chars / 180 = 14,563 rows max unshared; 7,281 rows at half quota; 3,640 rows at quarter quota. 180000 / 14563 = 12.4x overshoot -> does NOT fit"
  ],
  "residualRisks": [
    "mtgtop8 event-id sparsity not measured: e=88980 and e=89150 are editorial articles, not tournaments, so 89,865 is an upper bound and the true tournament count may be 5-15% lower",
    "MTGGoldfish yielded zero numbers (slug URLs, 404s, robots.txt disallows this agent class); the second-most-important comparable is a blank in the table",
    "melee.gg's MTG share is unmeasured; 3 of 5 sampled ids were Lorcana/Star Wars Unlimited, so its ~295k id ceiling was deliberately excluded from the 2x rule rather than quantified",
    "The 180 B/row input was supplied, not measured against the real Gones catalog schema; quota arithmetic scales linearly with it (250 B/row -> ~10,500 rows unshared)",
    "The ~5 MiB localStorage quota is assumed, not verified in the target browsers; Safari in particular differs and evicts",
    "web_search was unavailable for the entire run (model deprecation error), so coverage rests on direct fetches only; sites that block or JS-render (topdeck.gg, mtgdecks.net) could not be reached by any alternate route"
  ],
  "noStagedFiles": true,
  "diffSummary": "Added one new research brief at the mandated output path. No repository files read, modified, staged, or committed.",
  "reviewFindings": [
    "no blockers",
    "high: the stated Gones design (whole catalog in localStorage, ~5 MB quota) cannot hold the 2x-headroom ceiling of 180,000 rows - it needs ~62 MiB, a 12.4x overshoot. localStorage caps the catalog at ~14,563 rows unshared and ~7,281 rows when sharing the origin with other caches. Either the client cache moves to IndexedDB / the Archive pages server-side, or the honest cap is ~7,000 rows.",
    "medium: mtgtop8's intake is accelerating (187/yr in 2009 -> 17,510/yr annualised in 2026, roughly doubling every 4 years), so 2x-of-today buys about 4-5 years of headroom, not a decade. A ceiling set on today's snapshot will need revisiting.",
    "low: the summary table reports melee.gg's ~290k-300k id ceiling but excludes it from the ceiling calculation as a multi-TCG organiser platform. If the parent disagrees with that exclusion the 2x figure becomes ~590,000 and the localStorage design fails by ~40x."
  ],
  "manualNotes": "web_search was down for the whole run - every query in both batches returned 'Gemini API error: This model models/gemini-2.5-flash-lite is no longer available to new users.' All findings therefore come from direct primary-source fetches, which is arguably stronger evidence but left the blocked/JS-rendered sites (mtggoldfish, mtgdecks.net, topdeck.gg) unresolved and marked 'not found' rather than estimated. The single most load-bearing number is mtgtop8's highest observed event id, 89865, seen live on 2026-08-22 at https://www.mtgtop8.com/format?f=ST and confirmed by fetching the event page. Judgement call worth the parent's attention: I anchored the 2x rule on mtgtop8 (~90k) rather than melee.gg (~295k), because melee is a multi-TCG tournament-organiser platform - 3 of 5 sampled ids were Lorcana or Star Wars Unlimited - and not an MTG results archive comparable to Gones. Flagging it because the task said to take the largest credible figure across sites, and that exclusion is the difference between a 180,000 and a 590,000 answer."
}
```
