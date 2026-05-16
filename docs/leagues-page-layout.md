# Leagues Page Layout

This document captures the agreed layout direction for the Gones Leagues page. It is intentionally limited to layout and information hierarchy. It does not define visual style, colors, typography, or final component styling.

## Product Context

Gones manages tournament results across leagues so players and organizers can review standings, rounds, and player statistics.

Assumed users for this page:

- Tournament organizers who manage leagues and need to open the correct league quickly.
- Players who browse existing leagues to inspect tournaments, standings, and their statistics.

Confirmed user model:

- The MVP does not separate organizer and player interfaces.
- Organizers and players use the same pages.
- The same League page is used to consult data and insert or update data.

## Page Role

The Leagues page is the current homepage of the application. At the moment, the app logo should link back to `leagues.html`.

The page is a destination browser for leagues. It should not behave like a dense administrative table or compact list. Each League should feel like a large navigable item.

The most important repeated action is opening an existing League. Creating a League happens rarely, usually once per League. A League can contain many Tournaments, often around 10 to 20 or more, so users will frequently return to the Leagues page to open the relevant League before entering or consulting Tournament data.

Only one League link is expected to be most important at a time: the last active or most recently used League. The layout should support giving that League stronger prominence than the rest of the card grid.

## Global Header Layout

The app header should stay global and navigation-focused.

Recommended structure:

```txt
[ Gone logo ]        [ Breadcrumbs ]                         [ optional actions ]
```

Header requirements:

- The Gone logo sits on the left.
- Clicking the logo navigates to the current homepage, `leagues.html`.
- Breadcrumbs remain in the header, near the center or center-left depending on available space.
- Breadcrumbs provide navigation context and back-navigation.
- The header should not contain league-specific stats.

## Page Header Layout

The Leagues page content starts below the global header.

Recommended structure:

```txt
Leagues
Choose a league to view its tournaments, players, and current progress.
```

Page header requirements:

- The page title is large and clearly identifies the page: `Leagues`.
- A short description sits below the title.
- Do not show aggregate metrics for all leagues.
- Do not show global totals such as total tournaments, total players, or active league counts.
- If the most recently used League is known, the page can visually prioritize it before the rest of the League cards.

## League Card Grid

Leagues should be presented as large cards in a responsive grid.

If there is a last active or most recently used League, it can appear as a featured League card above the regular grid. This featured card still contains only League-specific information, but it has stronger placement because it represents the most likely next action.

Desktop / full HD:

```txt
[ Featured League Card ]

[ League Card ] [ League Card ] [ League Card ]
```

Medium screens:

```txt
[ Featured League Card ]

[ League Card ] [ League Card ]
```

Mobile:

```txt
[ Featured League Card ]

[ League Card ]
```

Grid requirements:

- Use a responsive card grid.
- Prioritize the last active League when available.
- Three cards per row is acceptable on full HD desktop screens.
- The layout should reduce to two columns on medium screens.
- The layout should reduce to one column on mobile.
- Prefer a minimum card width approach over hard-coded breakpoints where practical.
- Each card should remain large enough to feel like a destination, not a list row.

Example implementation direction:

```css
.leagues-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
}
```

The exact minimum width can be adjusted during implementation, but the layout goal is `3 -> 2 -> 1` columns.

## League Card Layout

Each League card contains information specific to that League only.

Recommended card structure:

```txt
┌────────────────────────────────┐
│ League Name            Running │
│ Short context/description      │
│                                │
│ 12 tournaments   84 players    │
│                                │
│ View league →                  │
└────────────────────────────────┘
```

Required card information:

- League name.
- Number of Tournaments in that League.
- Number of Player Names represented within that League.
- League status, such as `Running` or `Complete`.

Card behavior:

- The whole card should be clickable and navigate to the League page.
- A visible navigation cue, such as `View league`, can appear inside the card.
- The card should have a hover and keyboard focus state when implemented.
- The card should feel like a primary navigation item.

Information hierarchy inside the card:

1. League name.
2. League status.
3. Tournament and player counts.
4. Optional short description or contextual metadata.
5. Navigation cue.

## Explicit Non-Goals

- Do not use a table for the Leagues page.
- Do not use a compact list layout.
- Do not show page-level aggregate metrics across all leagues.
- Do not put League-specific stats in the global header.
- Do not make the card grid so dense that cards feel like small tiles.
- Do not make League creation visually compete with opening the last active League.
