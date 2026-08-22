# Research: MTG tournament archives — explicit SERIES / SEASON grouping vs. inferred

Date: 2026-08-22. All evidence from direct page fetches (see Sources). Facts marked **[observed]** were read off the fetched page; **[inference]** is my reasoning on top of them.

## Summary

Real MTG competitions **do** have a series+season structure, and several organisers name seasons explicitly (Star City Games "Season 5 - Round 2"; Face to Face Tour "2026-27 Round 2"; Wikipedia's Grand Prix index has a literal `Season` column with values like `1996–97`). But **public deck archives do not expose it as data.** On mtgtop8 the only grouping primitive is the `meta` bucket, which is a *mixed-axis* filter (rolling window · calendar year · format era · event tier · a handful of legacy series histories), not a series taxonomy — and its series buckets exist only for *defunct* series. Everything current (Regional Championship, RCQ, Spotlight Series, store leagues) is inferable **only from the event name string**.

---

## 1. Recurring series table

`Explicitly seasonal?` = the organiser itself publishes a season label.

| Series | Years active | Cadence | Explicitly seasonal? | Events per season | Source |
|---|---|---|---|---|---|
| Pro Tour (1996–2018) | 1996–2018 | 3–7 per season | **Yes** — seasons ran Aug→Aug, named `1996–97`, `2002–03`; Wikipedia has per-season articles | 5–6 early; 7 in `03-04`/`04-05`; 4→3 in 2012; back to 4 in 2014 | [Wikipedia PT](https://en.wikipedia.org/wiki/Magic:_The_Gathering_Pro_Tour) |
| Mythic Championship | 2019 only | ~7 in the year | Numbered events (I–VII), not seasons | 7 | [mtgtop8 meta=91](https://www.mtgtop8.com/format?f=ST&meta=91) **[observed]** |
| Players Tour | 2020 | 3 regions × 3 | **Yes** — "2020 season" | 9 + Finals | [Wikipedia PT](https://en.wikipedia.org/wiki/Magic:_The_Gathering_Pro_Tour) |
| Pro Tour (revived) | 2023– | 3 per calendar year + Worlds | Calendar-year aligned; no explicit season label found | 3 PT + 1 Worlds (2026: Jan 30, May 1, Jul 17, Worlds Nov 13) | [magic.gg 2026 schedule](https://www.magic.gg/news/the-pro-tour-and-magic-spotlight-series-in-2026) |
| Grand Prix | 1997–2020 (702 events, cancelled COVID) | 20–30/yr in the 1990s → 50–60/yr by the end | **Yes** for the PT-season era — the canonical list is keyed by a `Season` column (`1996–97`, `1997–98`, …) | 5 in `1996–97`, ~13 in `1997–98`, 50–60/yr later | [Wikipedia GP list](https://en.wikipedia.org/wiki/List_of_Magic:_The_Gathering_Grand_Prix_events) **[observed: literal Season column]** |
| MagicFest | 2019–2020 | Weekend convention wrapping a GP | No | — | [Wikipedia GP](https://en.wikipedia.org/wiki/Grand_Prix_(Magic:_The_Gathering)) |
| Magic Spotlight Series | 2025– (announced 2024-08-20) | 8 events in 2025; 11 in 2026, **aligned to set releases** | Not season-numbered; each stop named by theme/set | 8 (2025), 11 (2026) | [magic.gg announce](https://magic.gg/news/announcing-the-magic-spotlight-series), [magic.gg 2026](https://www.magic.gg/news/the-pro-tour-and-magic-spotlight-series-in-2026) |
| Regional Championship (US) | 2022– | 6 per year, at SCG CON; currently split into 2 events per Round | **Yes, strongly** — "Season 5 - Round 2", $100k, 32 PT invites | 6 RCs/yr → 3 Rounds/yr, 2 events per Round | [rcq.starcitygames.com](https://rcq.starcitygames.com/) **[observed]** |
| Regional Championship Qualifier (RCQ) | 2022– | Continuous, WPN + WPN Premium stores, thousands of events | **Yes** — RCQs are run inside the same numbered Season/Round windows | Very large (store-level) | [rcq.starcitygames.com](https://rcq.starcitygames.com/) |
| World Championship | 1994– (annual, no 2020) | Annual | Calendar year; also *numbered* — "World Championship 32" (2026) | 1 | [Wikipedia Worlds](https://en.wikipedia.org/wiki/Magic:_The_Gathering_World_Championship), [magic.gg 2026](https://www.magic.gg/news/the-pro-tour-and-magic-spotlight-series-in-2026) |
| Nationals / World Magic Cup | Nationals pre-2012; WMC 2012–2017 | Annual | Annual, by year | 1 per country | [Wikipedia Worlds](https://en.wikipedia.org/wiki/Magic:_The_Gathering_World_Championship) |
| MTGO League | ongoing | Continuous; a League "course" ends when a new set arrives | **No season concept** — Leagues are open-ended courses with a close/end timestamp | n/a | [mtgo.com events](https://www.mtgo.com/en/mtgo/events) **[observed]** |
| MTGO Challenge / Preliminary / Scheduled Events | ongoing | Multiple per day per format | No | n/a | [mtgo.com events](https://www.mtgo.com/en/mtgo/events); mtgtop8 shows `MTGO Challenge 32/64/96` daily |
| MOCS (Magic Online Champions Showcase) | ongoing | Qualifier Points feed periodic Showcases | Season-like, **not verified this run** | not found | [mtgo.com events](https://www.mtgo.com/en/mtgo/events) mentions Qualifier Points only |
| Face to Face Tour (Canada) | ongoing | ~10+ stops/yr | **Yes, and cross-year** — event URLs read `2026-27-round-2-<city>` | ~10 per Round | [f2ftour.com](https://f2ftour.com/) **[observed in URL slugs]** |
| SCG Tour / SCG CON | 2010s– ; SCG CON now hosts RCs + Spotlights | Convention weekends | Historical "SCG Tour Season N" **not verified this run** — current SCG seasonality is the RC Season/Round scheme | not found | [rcq.starcitygames.com](https://rcq.starcitygames.com/) |
| Nerd Rage Gaming Championship Series (NRG) | current | Multi-stop US circuit | not found | not found | [magic.gg/events](https://magic.gg/events) **[observed listing]** |
| CommandFest | current | Multi-city, ~annual lineup announcement | Annual lineup ("2026's CommandFest lineup"), no season number | ~annual set | [magic.gg/events](https://magic.gg/events) |
| Japan: Champions Cup / BIG MAGIC circuit | ongoing | Regional Championship equivalent | Historically "Champions Cup Season N Round M"; **page is JS-only, could not read** | not found | bigmagic.net championscup (JS-gated) |
| Japan: The Last Sun | ongoing | Annual + qualifiers | Year-labelled: `The Last Sun 2026 Qualifier` | many qualifiers | mtgtop8 event listing **[observed]** |
| Legacy European Tour | ongoing | Multi-stop EU Legacy circuit | not found — site unreachable this run | not found | legacyeuropeantour.eu (fetch failed) |
| Eternal Weekend | ongoing | Annual per region (NA/EU/Asia) | not found — site unreachable this run | not found | eternalweekend.net (fetch failed) |
| Arena Championship / Arena Open | 2022– | Arena Championship ~3/yr, Arena Open monthly-ish | **not found** this run (no reachable primary page) | not found | not found |
| Store-level leagues (thousands) | ongoing | Weekly/monthly | **Often yes**, self-labelled — e.g. `Charlotte League Season 3 Week 7` | 7+ weeks per season | [mtgtop8 e=89767](https://www.mtgtop8.com/event?e=89767&f=LE) **[observed]** |

**Bottom line for Q1:** the strongest, most machine-friendly explicit seasons in *current* MTG are (a) the **Regional Championship "Season N - Round M"** scheme and (b) **regional tours copying it** (F2F `2026-27 Round 2`), plus (c) **store leagues** that name their own `Season N`. Historic PT/GP had explicit named Aug→Aug seasons.

---

## 2. mtgtop8's `meta` taxonomy — what it actually groups by

**Verdict: `meta` is NOT a series taxonomy.** It is a per-format list of hand-curated metagame *slices*, mixing at least five different axes. Series appears as *one* of those axes and only for retired series.

Observed axes:

1. **Rolling time window** — `Last 5 Days`, `Last 2 Weeks`, `Last 2 Months`
2. **Event tier / source** — `Large Events Last 2 Months`, `Last Major Events (2 Months)`, `Live Tournaments Last 2 Months`, `MTGO Last 2 Months`
3. **Calendar year** — `All 2026 Decks` … `All 2011 Decks`
4. **Format era (card-pool epoch, NOT a season)** — `Standard 2017-2018 (Kaladesh to M19)`
5. **Series history (legacy series only)** — `History - All Pro Tour`, `History - All Grand Prix`, `History - All Worlds`, `History - All Nationals & Continentals`, `History - All PT & GP`

Ids are **per-format**: the same concept has a different id in each format (`Last 2 Weeks` is `meta=50` in Standard, `meta=54` in Modern, `meta=194` in Pioneer). So `meta` is not even a global vocabulary.

### Observed id → label pairs

**Standard (`f=ST`)** — all read off `https://www.mtgtop8.com/format?f=ST&meta=91`:

| id | label | axis |
|---|---|---|
| 50 | Last 2 Weeks | window |
| 52 | Last 2 Months | window |
| 326 | Last 5 Days | window |
| 46 | Large Events Last 2 Months | tier |
| 285 | MTGO Last 2 Months | source |
| 341 | All 2026 Decks | calendar year |
| 312 | All 2025 Decks | calendar year |
| 281 | All 2024 Decks | calendar year |
| 250 | All 2023 Decks | calendar year |
| 249 | All 2022 Decks | calendar year |
| 217 | Standard 2020-2021 (M21 to Kaldheim) | format era |
| 187 | Standard 2019-2020 (M20 to Eldraine) | format era |
| 175 | Standard 2018-2019 (M19 to War of the Spark) | format era |
| 161 | Standard 2017-2018 (Kaladesh to M19) | format era |
| 128 | Standard 2016-2017 (Battle for Zendikar Block - Amonkhet Block) | format era |
| 133 | Standard 2015-2016 (Tarkir Block - Battle for Zendikar Block) | format era |
| 114 | Standard 2014-2015 (Theros Block - Tarkir Block) | format era |
| 86 | Standard 2013-2014 (Return to Ravnica Block - Theros Block) | format era |
| 75 | Standard 2012-2013 (Innistrad Block - Return to Ravnica Block) | format era |
| 74 | Standard 2011-2012 (Scars Block - Innistrad Block) | format era |
| 45 | Standard 2010-2011 (Zendikar Block - Scars Block) | format era |
| 58 | All Standard decks | all |
| 97 | History - All Worlds | **series** |
| 91 | History - All Pro Tour | **series** |
| 296 | History - All Nationals & Continentals | **series (two series merged)** |
| 96 | History - All Grand Prix | **series** |

**Modern (`f=MO`)**: 54 Last 2 Weeks · 51 Last 2 Months · 304 Last 5 Days · 189 Last Major Events (2 Months) · 57 Live Tournaments Last 2 Months · 339/315/276/246/236/220/200/183/163/142/118/101/79/77/76/78 = All 2026…All 2011 Decks · 44 All Modern Decks · **92 History - All PT & GP** (note: PT and GP *merged into one bucket* — proof these are editorial slices, not a taxonomy).

**Pioneer (`f=PI`)**: 194 Last 2 Weeks · 193 Last 2 Months · 305 Last 5 Days · 279 Last Major Events (2 Months) · 278 Live Tournaments Last 2 Months · 340/314/277/247/235/222/202/201 = All 2026…All 2019 Decks · 260 All Major Events · 191 All Pioneer Decks. **No series buckets at all** — Pioneer post-dates the GP era.

### What the event record itself carries

Fetched `https://www.mtgtop8.com/event?e=89767&f=LE`. The event page exposes exactly: **title string** (`Charlotte League Season 3 Week 7`), **venue string** (`Parker Banner Kent Wayne (Cornelius, NC)`), **format** (`Legacy`), **star rating** (1–4 stars / "bigstar" = importance tier), **player count** (`16 players`), **date** (`18/08/26`), and decklists. There is **no series field, no season field, no organiser field, no parent-event id.** The star rating is the only first-class classification and it encodes *importance*, not series.

The deck search (`/search`) is a title-substring + format + date-range + archetype + player search. Series/season is not a facet.

**Q2 answer: on mtgtop8 the grouping is (a) time and (b) editorial metagame slices; series grouping exists only as four hardcoded history buckets for dead series, and is otherwise recoverable only by parsing the event name string.**

---

## 3. Real observed event-name strings

All strings below are verbatim from mtgtop8 pages fetched today (some non-ASCII chars came through mangled by the fetcher and are marked).

| # | Observed name | Series encoded? | Season encoded? |
|---|---|---|---|
| 1 | `Pro Tour Secrets of Strixhaven` @ `Las Vegas` | yes (prefix) | no — set name, not season |
| 2 | `Pro Tour Aetherdrift - 2nd Chance PTQ @Wizards of the Coast` | yes, but two series mashed in one string | no |
| 3 | `Pro Tour Cleveland (Mythic Championship I)` | yes, two names for one event | no |
| 4 | `Standard - Pro Tour 25th (Minneapolis)` | yes, prefixed by *format* | no |
| 5 | `Mythic Championship VII Qualifier Weekend` | yes | roman-numeral instalment, not season |
| 6 | `Grand Prix Richmond 2019` | yes | **year in name** |
| 7 | `Grand Prix Toronto 2018 - Team Trios` | yes | year + variant suffix |
| 8 | `Grand Prix Madrid 2018 - Team Constructed` | yes | year + variant suffix |
| 9 | `MTGO Challenge 32` / `MTGO Challenge 64` / `MTGO Challenge 96` | yes | no — the number is the *player cap*, not an instalment |
| 10 | `MTGO League` | yes | no |
| 11 | `MTGO RC Super Qualifier` | yes | no |
| 12 | `Charlotte League Season 3 Week 7` @ `Parker Banner Kent Wayne (Cornelius, NC)` | yes | **`Season 3` + `Week 7` — fully explicit** |
| 13 | `Overlegacy Series 2026 Etapa 1` @ `Overrun Geekstore (Araraquara, Brazil)` | yes | **year + leg number** |
| 14 | `3<mangled> Etapa Regular - 2026/2` @ `Vila Celta Hobby Store (Curitiba, Brazil)` | weak | **`2026/2` = year + half/split** |
| 15 | `1<mangled> Etapa CLM` @ `Mont CardShop (Campinas, Brazil)` | abbreviation only | leg number, no year |
| 16 | `Sunday 5k RCQ` @ `LFG Con 2026 - Fire & Dice (Burbank, CA)` | yes (`RCQ`) | no — season/round absent |
| 17 | `The Last Sun 2026 Qualifier` @ `Chiba (Japan)` | yes | **year** |
| 18 | `Tokai Championship 14th` @ `Nagoya (Japan)` | yes | **instalment number, no year** |
| 19 | `3City League (HOB) #2` @ `SideQuest (Gdańsk, Poland)` | yes | instalment `#2`, season implied by set code `HOB` |
| 20 | `Haarlem Night 34` @ `Spellenhuis (Haarlem, Netherlands)` | yes | instalment `34`, no season |
| 21 | `Series` @ `Bottrop (Germany)` | literally the word "Series" and nothing else | no |
| 22 | `Weekly Najada` / `UC Monthly` / `Monthly DC Event` | cadence in name | no |
| 23 | `DCQC #25` @ `Jeux Face à Face (Montréal, Québec)` | acronym | instalment |
| 24 | `Liga Sword - Primeira Etapa` @ `Sword Luderia (Teresina, Brazil)` | yes | leg name, no year |
| 25 | `B4 Savannah D'Uragon Series I` @ `Game 3 Hobby Shop (Naga City, Philippines)` | yes | instalment `I` |

**Pattern read [inference]:** there is **no convention**. Series appears as a prefix, a suffix, a parenthetical, an acronym, or not at all. Season appears as a bare year, a `Season N`, a `YYYY/N` split, a leg ordinal, a roman numeral, a week number, or absent. Multilingual too (`Etapa`, `Liga`, `Hebdomadaire`, `Weekly`). A parser can get maybe the big series (`Pro Tour`, `Grand Prix`, `MTGO Challenge`, `RCQ`) reliably; long-tail store series are effectively unparseable without per-store rules.

Also note the strings that *do* carry a season are mostly the ones you least care about (store leagues), while the ones you most care about (`Sunday 5k RCQ`) carry no season at all.

---

## 4. Recommendation: is calendar year a defensible default?

**Yes — with named exceptions.** Reasons:

1. It is what the largest archive itself does. mtgtop8's own generic buckets are `All 2026 Decks`, `All 2025 Decks`, … **[observed, all three formats checked]**. If you mirror mtgtop8, calendar year is a *faithful* default, not an invention.
2. The current flagship series are calendar-aligned: 2026 Pro Tours + Worlds all sit inside one calendar year, and Spotlight Series 2026 runs Jan→Oct within the year ([magic.gg](https://www.magic.gg/news/the-pro-tour-and-magic-spotlight-series-in-2026)).
3. Year is always derivable from an event date, so it never fails to produce a bucket.

**Where a calendar-year split is clearly wrong:**

- **Pro Tour 1996–2012** — seasons ran **August → August** and are *named* `1996–97`, `2002–03`. A calendar split shreds every one of them. Wizards explicitly tried to force calendar alignment in 2003–05 and had to make those seasons 7 events long; in 2012 the season moved to **May → May**. ([Wikipedia](https://en.wikipedia.org/wiki/Magic:_The_Gathering_Pro_Tour))
- **Grand Prix 1997–~2012** — inherits the same `1996–97`-style season keying; the canonical index is *sorted by that season*, not by year. ([Wikipedia GP list](https://en.wikipedia.org/wiki/List_of_Magic:_The_Gathering_Grand_Prix_events))
- **Face to Face Tour (Canada)** — currently runs a **`2026-27`** season, Round 2 of which starts in August 2026. ([f2ftour.com](https://f2ftour.com/))
- **Regional Championships / RCQ** — organised as `Season N - Round M` with 6 RCs per year in 3 Rounds; Season 5 Round 2's RCs are dated "January - February", i.e. a Round's qualifying window and its championship land on opposite sides of New Year. ([rcq.starcitygames.com](https://rcq.starcitygames.com/))
- **Store leagues** — `Charlotte League Season 3 Week 7` has its own season clock with no relation to the calendar.

**How common:** for the *modern paper premier* scene (Pro Tour 2023–, Spotlight Series, Worlds) calendar year is correct. For the *historic* scene (PT/GP 1996–2012, roughly 700 GPs + ~90 PTs) it is wrong. For the *qualifier* scene (RC/RCQ, F2F, store leagues) it is wrong but recoverable when the organiser labels the season. So: **calendar year is the right default, and must be overridable.**

Practical rule [inference]: default `season = calendar year of event date`; if the event name matches an explicit season token (`Season\s+(\d+)`, `\b(20\d\d)[-/](\d\d?)\b`, `\b(19|20)\d\d[-–](19|20)?\d\d\b`), prefer the parsed token; never *require* a season to exist.

---

## 5. Implications for dev fixtures (League → Season → Tournament)

1. **Seasons must be optional and nullable at the season-label level.** Real archives frequently give you a tournament with a series but no season. Generate fixtures where some leagues have `Season 1..N` labels and some have only year-derived seasons, otherwise the UI never gets exercised on the common case.
2. **Model season label as a free string, not an integer year.** Real labels observed: `2026-27`, `Season 5 - Round 2`, `2026/2`, `1996–97`, `Season 3`. An int-year column cannot hold any of the first four.
3. **Season boundaries must be allowed to cross the year boundary.** Generate at least one fixture league with an Aug→Aug or autumn→spring season (mirroring PT 1996–2012 and F2F `2026-27`) so date-bucketing bugs surface.
4. **Vary events-per-season wildly.** Observed real spreads: 1 (Worlds), 3–4 (modern Pro Tour), 5–13 (early GP seasons), 6 (Regional Championships), 8–11 (Spotlight Series), 50–60 (late GP), 7+ weekly legs (store league), effectively unbounded (RCQ, MTGO). A fixture generator that always emits ~10 per season will not stress the archive list.
5. **Include the two-level naming collision.** Real series nest: `Pro Tour Aetherdrift - 2nd Chance PTQ` is a *qualifier* series named after a *Pro Tour* event. Generate at least one child series whose name embeds the parent's, so grouping-by-name-prefix heuristics visibly break.
6. **Include unnamed / degenerate cases.** `Series` (literally), `1K`, `FNM`, `Weekly` — tournaments whose names carry no series signal. These should land in a "no league" or single-tournament bucket, not silently create garbage leagues.
7. **Include non-ASCII and non-English names.** `3ª Etapa Regular - 2026/2`, `Liga Sword - Primeira Etapa`, `Hebdomadaire`, `Gdańsk`. mtgtop8 itself serves these with broken encoding, so the ingest path deserves a fixture with accented characters.
8. **Do not model a `series_id` as if the source provides one.** If you scrape mtgtop8, the League tier is *your* construct derived from names + optional manual mapping. Fixtures should reflect that: give leagues a stable local id and a `sourceSeriesId: null`.

---

## Sources

**Kept**
- [mtgtop8 Standard meta=91 "History - All Pro Tour"](https://www.mtgtop8.com/format?f=ST&meta=91) — the full Standard `meta` sidebar; primary evidence for the whole taxonomy claim.
- [mtgtop8 Standard meta=96 "History - All Grand Prix"](https://www.mtgtop8.com/format?f=ST&meta=96) — confirms label, plus 20 real GP event-name strings.
- [mtgtop8 Standard meta=97 "History - All Worlds"](https://www.mtgtop8.com/format?f=ST&meta=97) — confirms label.
- [mtgtop8 Modern format page](https://www.mtgtop8.com/format?f=MO) — proves ids are per-format and that PT+GP are merged into one bucket (`meta=92`).
- [mtgtop8 Pioneer format page](https://www.mtgtop8.com/format?f=PI) — proves newer formats have *no* series buckets at all.
- [mtgtop8 event 89767](https://www.mtgtop8.com/event?e=89767&f=LE) — the event record's actual field set; no series/season field.
- [mtgtop8 Legacy / Duel Commander listings](https://www.mtgtop8.com/format?f=LE) — long tail of store-series naming.
- [Wikipedia: Magic: The Gathering Pro Tour](https://en.wikipedia.org/wiki/Magic:_The_Gathering_Pro_Tour) — Aug→Aug seasons, 2003–05 calendar-alignment attempt, 2012 May start, events-per-season counts.
- [Wikipedia: List of Grand Prix events](https://en.wikipedia.org/wiki/List_of_Magic:_The_Gathering_Grand_Prix_events) — literal `Season` column with `1996–97` style values.
- [Wikipedia: Grand Prix (MTG)](https://en.wikipedia.org/wiki/Grand_Prix_(Magic:_The_Gathering)) — 702 events, 20–30 → 50–60/yr, MagicFest rebrand, Spotlight as successor.
- [Wikipedia: World Championship](https://en.wikipedia.org/wiki/Magic:_The_Gathering_World_Championship) — annual cadence, Worlds-as-season-finale until 2011.
- [magic.gg: Announcing the Magic Spotlight Series](https://magic.gg/news/announcing-the-magic-spotlight-series) — 2025: 8 events, organisers SCG/Fanfinity/BIG MAGIC.
- [magic.gg: The Pro Tour and Magic Spotlight Series in 2026](https://www.magic.gg/news/the-pro-tour-and-magic-spotlight-series-in-2026) — full 2026 calendar, "aligning our Spotlight Series events to our set releases", Worlds 32.
- [rcq.starcitygames.com](https://rcq.starcitygames.com/) — **best explicit-season evidence**: "Season 5 - Round 2", "six times each year", RCQ→RC structure.
- [f2ftour.com](https://f2ftour.com/) — cross-year season evidence in URL slugs `2026-27-round-2-<city>`.
- [mtgo.com Events & Formats](https://www.mtgo.com/en/mtgo/events) — Leagues/Queues/Scheduled Events; League courses end on set release, no season concept.
- [magic.gg/events](https://magic.gg/events) — surfaces NRG Championship Series and CommandFest as live circuits.

**Dropped / unreachable**
- `mtg.fandom.com` (Regional Championship, Magic Spotlight Series) — HTTP 403, blocked.
- `eternalweekend.net` / `www.eternalweekend.net` — fetch failed both spellings.
- `legacyeuropeantour.eu` — fetch failed.
- `wpn.wizards.com/en/organized-play` — fetch failed.
- `magic.wizards.com/en/premier-play` — HTTP 404; `magic.gg/premier-play` returns an empty shell.
- `ssl.bigmagic.net/championscup` — JavaScript-only app, no server-rendered content.
- `magic.wizards.com/en/news/announcements` — index only, no premier-play season article in the current window.
- `mtgtop8.com/search` and `?f=LE` sidebar — forms/sidebar stripped by the fetcher; search facets inferred from the rendered page and event page instead.

---

## Gaps

1. **Wizards' own definition of an RCQ/RC season window** — I have SCG's operator-side view (`Season 5 - Round 2`) but not Wizards' first-party article stating season start/end dates. `wpn.wizards.com` and `magic.wizards.com/en/premier-play` were unreachable. *Next step:* fetch `https://wpn.wizards.com` via a different path or the Wayback Machine.
2. **SCG Tour historical seasons** — the question asked specifically whether SCG ran "Season 3"-style splits. Current SCG pages are entirely RC/RCQ-oriented. **Not found.** *Next step:* Wayback Machine on `starcitygames.com/scgtour` circa 2016–2019.
3. **Arena Championship / Arena Open cadence and season labels** — **not found**; no reachable primary page this run.
4. **Legacy European Tour and Eternal Weekend** — both sites failed to fetch. **Not found.**
5. **Japanese Champions Cup season/round labels** — the official page is JS-gated. Strongly suspected to use `Season N Round M` (the RC scheme originates there), but **unverified**.
6. **Whether mtgtop8 GP-era events carry the Aug→Aug season anywhere** — from the event page inspection, no; only the date. So the Wikipedia `Season` column is the *only* place that grouping survives as data.
7. **The `web_search` tool was unavailable for this entire run** — every call returned `Gemini API error: This model models/gemini-2.5-flash-lite is no longer available to new users.` All findings above therefore come from direct page fetches only. That is why gaps 2–5 are unresolved: they needed discovery search, not a known URL.
