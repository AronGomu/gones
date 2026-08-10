# T3: Home last-card row rule

**Plan:** `./ai-artifacts/PLAN_2026_08_09_feedback-calendar-v1-round-2.md`
**Depends:** T2
**Commit outcome:** The last home menu card spans the full row only when it would otherwise sit alone on that row; when the last row already holds two cards, every card — About included — is half width.

## Context (self-contained)

- Goal: land round-2 feedback on Gones (Angular 21 standalone components, single global stylesheet `src/styles.css`, dark-metal / blood-red theme).
- This slice: feedback line 1 — "On the homepage, the About redirection card should be the same width as all other cards. So on full screen, it should be half size. Just make a rule that the last card, if an entire row is available, takes the whole row, but if the last row already has two elements, each element takes half the width like every other card before."
- Out of scope here: the toolbar, the login card removal (done in T2), card content, card colours, any TypeScript change.
- Assumptions in force: **A7** — this is a generic rule on the last child, not a special case for the About card. With the login card removed in T2, an anonymous visitor now has 5 cards, so About spans the row for them; a signed-in visitor has 6 cards (the `/registrations` card appears), so About is half width. That is the rule behaving correctly, not a bug.

### Current state — read before editing

`src/styles.css`:

- line 127: `.home-destinations { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }`
- line 138: `.home-destination--about { grid-column: 1 / -1; min-height: 10rem; border-color: …; background: …; }` — **the `grid-column: 1 / -1` here is the defect.** It pins About to a full row unconditionally.
- line 449 (inside a narrow-viewport media query): `.home-destinations, .calendar-empty-callout, … { grid-template-columns: 1fr; }`
- line 450 (same media query): `.home-destination--about { grid-column: auto; }` — this exists only to undo line 138 on a single-column grid. Once line 138's `grid-column` is gone, this override is dead and must go too.

`src/app/features/menu/home-menu.component.ts` renders, in order, inside `<nav class="home-destinations">`:

1. `menu-running-tournaments-card` — always
2. `menu-leagues-archive-card` — always
3. `menu-calendar-card` — always
4. `menu-registrations-card` — only when `auth.profile()` is truthy
5. `menu-settings-link` — always
6. `menu-about-link` — always

Angular's `@if` blocks compile to comment anchors, not elements, so `:nth-child` counts only the rendered anchors. The classic two-column rule therefore works directly.

- **From Depends (T2):** the `menu-login-card` anchor has been deleted from `home-menu.component.ts`. The signed-out card count is 5; the signed-in count is 6.

## Requirements

- The rule is expressed once, on `.home-destinations > :last-child:nth-child(odd)`, and applies to whichever card happens to be last.
- `.home-destination--about` keeps every one of its other declarations (`min-height`, `border-color`, `background`) and loses only `grid-column`.
- The dead `.home-destination--about { grid-column: auto; }` override in the narrow-viewport media query is deleted.
- On the single-column narrow layout nothing changes visually: every card is already full width there, and a `grid-column: 1 / -1` on a one-column grid is a no-op.

## Inputs

- `src/styles.css` — lines 127, 138 and 450 as quoted above.
- `src/app/features/menu/home-menu.component.ts` — for the card order and count only; **do not edit it in this ticket**.
- **From Depends:** see above.

## TDD

1. **Red** — write `src/app/features/menu/home-grid-rule.test.ts` first. It reads `src/styles.css` as text and asserts the new rule exists and the old pin is gone. It fails on the current stylesheet.
2. **Green** — make the three stylesheet edits.
3. **Refactor** — only if needed. Keep green.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `a lone last card spans the whole row` | `src/styles.css` text | matches `/\.home-destinations\s*>\s*:last-child:nth-child\(odd\)\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/` |
| `the about card is no longer pinned to a full row` | `src/styles.css` text | the `.home-destination--about {` declaration block does **not** contain `grid-column` |
| `the about card keeps its own styling` | `src/styles.css` text | the `.home-destination--about {` block still contains `min-height`, `border-color` and `background` |
| `the dead narrow-viewport override is gone` | `src/styles.css` text | does not contain `.home-destination--about { grid-column: auto; }` |
| `the grid is still two columns at full width` | `src/styles.css` text | `.home-destinations {` block contains `repeat(2, minmax(0, 1fr))` |
| `signed out renders an odd number of cards` | `home-menu.component.ts` text | exactly 5 occurrences of `class="home-destination` sit outside any `@if (auth.profile())` block |

For the last row, count with a simple helper in the test: strip the `@if (auth.profile()) { … }` block by regex, then count `home-destination` class occurrences in what remains. Assert `5`. This is the assertion that catches somebody silently re-adding a card and breaking the parity the rule depends on.

## Impl steps

- [x] 1. Create `src/app/features/menu/home-grid-rule.test.ts` with the six tests above. Read the stylesheet with `readFileSync(join(__dirname, '..', '..', '..', 'styles.css'), 'utf8')` — from `src/app/features/menu/` that resolves to `src/styles.css`. Verify the path resolves before writing assertions.
- [x] 2. Run `npx vitest run src/app/features/menu/home-grid-rule.test.ts` — it must fail. (3/6 failed on unedited stylesheet, confirming red.)
- [x] 3. In `src/styles.css` line 138, delete `grid-column: 1 / -1;` from `.home-destination--about`. Leave `min-height: 10rem;` and everything after it untouched.
- [x] 4. In `src/styles.css`, immediately after the `.home-destinations` rule on line 127, insert:
      ```css
      /* Last card takes the whole row only when it would sit alone on it; with an even count every card stays half width. */
      .home-destinations > :last-child:nth-child(odd) { grid-column: 1 / -1; }
      ```
- [x] 5. In `src/styles.css`, in the narrow-viewport media query around line 450, delete the whole `.home-destination--about { grid-column: auto; }` rule.
- [x] 6. Run `npx vitest run src/app/features/menu/home-grid-rule.test.ts` — green. (6/6 passed.)

## Outputs

- New: `src/app/features/menu/home-grid-rule.test.ts`.
- Changed: `src/styles.css` (one rule added, two declarations removed).
- Behaviour: the About card is half width whenever the last home row already holds two cards; the last card — whichever it is — spans the row only when alone.

## Validation

- [x] `npm run test` passes (81 files, 538 tests passed, including the 6 new `home-grid-rule.test.ts` assertions)
- [x] `npm run lint` passes ("All files pass linting.")
- [x] `npm run typecheck` passes (no output, exit 0)
- [x] `npm run build` passes ("Application bundle generation complete.")
- [ ] Manual: `npm run dev`, open `http://127.0.0.1:4200/` at 1440px **signed out** — 5 cards, About alone on row 3 and spanning it. NOT run — no live browser in this session; automated proof is the `home-grid-rule.test.ts` "signed out renders an odd number of cards" (5) test plus the CSS `:last-child:nth-child(odd)` rule test. Logged in manual checklist for human verification.
- [ ] Manual: sign in as `admin@gones.test` — 6 cards, row 3 holds My registrations/Settings/About laid out two-per-row with About half width, none stretched. NOT run — same reason; the About-card-not-pinned test plus the even-card-count arithmetic (5 + registrations card = 6) is the automated proxy. Logged in manual checklist.
- [ ] Manual: shrink to 480px — every card is full width, no horizontal overflow, no gap artefact where the old override used to be. NOT run — same reason; automated proxy is the "dead narrow-viewport override is gone" test confirming no leftover `grid-column: auto` rule. Logged in manual checklist.
- [x] app functional — no broken path from this slice (full test suite, lint, typecheck, build all pass; no TS files touched)
- [x] commit msg draft: `fix(menu): size the last home card by row occupancy instead of pinning About`
