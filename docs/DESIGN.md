---
name: Gones
description: A dark, practical tournament tool with high-contrast red accents and old-school trading-card material character.
colors:
  black-forge: "#111113"
  deep-black-metal: "#18181b"
  raised-iron: "#222226"
  soot-border: "#38383d"
  muted-steel: "#6f6f78"
  ash-text: "#e8e5df"
  dim-ash-text: "#aaa49b"
  blood-red: "#e01222"
  hot-red: "#ff2638"
  deep-blood-red: "#4a070d"
  create-green: "#1f8f4d"
  create-green-hot: "#2fbf68"
  rust-plate: "#4a2720"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "3rem"
    fontWeight: 720
    lineHeight: 1.08
    letterSpacing: "0"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "2rem"
    fontWeight: 720
    lineHeight: 1.12
    letterSpacing: "0"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 720
    lineHeight: 1.18
    letterSpacing: "0"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.08em"
rounded:
  sm: "2px"
  md: "4px"
  lg: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.blood-red}"
    textColor: "{colors.ash-text}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  button-create:
    backgroundColor: "{colors.create-green}"
    textColor: "{colors.ash-text}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  button-danger:
    backgroundColor: "{colors.deep-blood-red}"
    textColor: "{colors.ash-text}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  button-secondary:
    backgroundColor: "{colors.deep-black-metal}"
    textColor: "{colors.ash-text}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
  card:
    backgroundColor: "{colors.deep-black-metal}"
    textColor: "{colors.ash-text}"
    rounded: "{rounded.lg}"
    padding: "24px"
  input:
    backgroundColor: "{colors.black-forge}"
    textColor: "{colors.ash-text}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
---

# Design System: Gones

## 1. Overview

**Creative North Star: "The Old-School Tournament Relic"**

Gones is a practical product interface with the weight of a dark metal tournament relic. It should use familiar SaaS dashboard structure, but the first impression should read as old-school trading-card tournament software, especially Magic-adjacent, without copying official card frames, art, symbols, or assets.

The visual system is low-density and phone-first. Most screens contain a small number of large forms, card items, or list objects. The user should never feel surrounded by decorative panels or secondary controls. Design the phone layout first for an iPhone 11-class viewport because the primary real-world use is checking Tournaments and entering or correcting results on a phone during events.

Old-school fantasy and card-game influence belongs in the typography, square card-like surfaces, heavy borders, color temperature, and subtle material character. It should not become literal fantasy decoration.

**Key Characteristics:**

- Dark black and iron surfaces.
- High-contrast red accent for primary emphasis, green for creation actions, and very dark red for deletion actions.
- Subtle rust/metal material cues through borders, tonal panels, and muted warm accents.
- Squarer card-like surfaces with heavier borders.
- Large touch-friendly controls.
- Clear SaaS-style information hierarchy.
- Clean product typography with enough weight to feel serious, but no cursive or old-style serif treatment.

## 2. Colors

The palette is a restrained dark product palette: black metal neutrals carry most of the surface, with vivid red used sparingly for action and emphasis. Rust is secondary material warmth only, not the accent color.

### Primary

- **Blood Red** (`#e01222`): Primary emphasis, active location, and important current-state cues. It must read as red, not orange.
- **Hot Red** (`#ff2638`): Hover or highlighted accent state. Use as a brighter companion to Blood Red, not as a second competing theme.
- **Deep Blood Red** (`#4a070d`): Delete and destructive actions. It should feel very dark and serious, never bright or playful.
- **Create Green** (`#1f8f4d`): Creation actions, including New League and Create League. Use when an action creates a new object.
- **Create Green Hot** (`#2fbf68`): Hover or highlighted state for creation actions only.

### Secondary

- **Rust Plate** (`#4a2720`): Muted warm panel, badge, or border support when a surface needs subtle material character.

### Neutral

- **Black Forge** (`#111113`): Main page background.
- **Deep Black Metal** (`#18181b`): Header, card, and form surface.
- **Raised Iron** (`#222226`): Elevated or grouped panel surface.
- **Soot Border** (`#38383d`): Standard border and divider.
- **Muted Steel** (`#6f6f78`): Secondary text, subdued icons, inactive nav.
- **Ash Text** (`#e8e5df`): Primary text.
- **Dim Ash Text** (`#aaa49b`): Body support text and descriptions.

### Named Rules

**The Action Color Rule.** Creation actions are green. Delete and destructive actions are very dark red. Blood Red remains for active location, important current-state cues, and non-creation primary emphasis.

**The Card-Game Before SaaS Rule.** The first impression should not be generic dashboard software. Use dark card-like planes, strong rectangular borders, and old-school title typography to make the surface recognizable.

**The Metal Before Ornament Rule.** Rust and metal character should come from restrained borders, tonal layers, and muted warmth, not texture overlays or fantasy decoration.

## 3. Typography

**Display Font:** Inter, system UI, sans-serif  
**Body Font:** Inter, system UI, sans-serif  
**Label/Mono Font:** System UI, with uppercase labels where useful

**Character:** Typography should feel like a serious SaaS product: clean, controlled, and readable. Old-school trading-card character should come from color, borders, layout, and material tone rather than cursive or serif letterforms.

### Hierarchy

- **Display** (720, 3rem, 1.08): Page titles and major screen headings.
- **Headline** (720, 2rem, 1.12): Section headers and featured cards.
- **Title** (720, 1.375rem, 1.18): Card titles and form group titles.
- **Body** (400, 1rem, 1.5): Descriptions, helper text, and readable content. Cap long prose around 65 to 75 characters.
- **Label** (700, 0.8125rem, 0.08em): Field labels, small section labels, status metadata, and compact UI labels.

### Named Rules

**The Product Type Rule.** Use one clean sans-serif family across headings, controls, labels, and data. Create character through weight, scale, and spacing rather than decorative type.

- **No default kicker** — page titles stand alone. A kicker above an `<h1>` is opt-in, never the default.

## 4. Elevation

Gones should rely mostly on tonal layering, borders, and surface contrast. Shadows are allowed, but they should be subtle and structural, not glossy or floating.

### Shadow Vocabulary

- **Card Lift** (`0 24px 80px rgba(0, 0, 0, 0.32)`): Featured card or major focused surface only.
- **Small Interaction Lift** (`0 10px 28px rgba(0, 0, 0, 0.22)`): Hover state for clickable cards when motion is useful.

### Named Rules

**The Flat At Rest Rule.** Most components sit flat in the layout. Depth comes from borders and darker/lighter metal layers before shadows.

## 5. Components

### Buttons

- **Shape:** Squared rectangle (`2px` to `4px`), never pill-shaped.
- **Primary:** Blood Red background, Ash Text, medium-heavy weight, at least `40px` high. Do not use Primary for creation if a dedicated Create button is available.
- **Create:** Create Green background, Ash Text, medium-heavy weight, at least `40px` high. Use for every action that creates a new object, such as New League and Create League.
- **Danger / Delete:** Deep Blood Red background, Ash Text, medium-heavy weight, at least `40px` high. Use for every delete or destructive action.
- **Secondary:** Dark metal surface with Soot Border and Ash Text.
- **Hover / Focus:** Shift border or background tone. Focus must be visible. Avoid glow-heavy effects.

### Chips

- **Style:** Small bordered label with dark or muted rust background.
- **State:** Status chips should include text labels such as `Running`, `Complete`, or `Setup`. Do not rely on color alone.

### Cards / Containers

- **Corner Style:** `2px` to `6px`.
- **Background:** Deep Black Metal or Raised Iron.
- **Shadow Strategy:** Flat by default, subtle lift only for featured or interactive cards.
- **Border:** One complete border using Soot Border or muted rust. Do not add inset/double borders.
- **Internal Padding:** Large enough for touch and scanning, usually `20px` to `24px`.

### Inputs / Fields

- **Style:** Dark input background, full border, `2px` to `4px` radius, large tap target.
- **Focus:** Border or outline shifts toward Blood Red or Hot Red.
- **Error / Disabled:** Error can use red, but must include a text label or message.

### Navigation

- **Header:** Dark metal bar with the Gones logo on the left, breadcrumbs next to it, and actions on the right.
- **Breadcrumbs:** One bordered breadcrumb container. Current page text uses accent color only, not a pill or button shape.
- **Active State:** Accent text, stronger weight, and no extra ornament.
- **Mobile Treatment:** Header actions may wrap or collapse, but primary navigation must remain visible.

### Phone-First Layout

- **Primary canvas:** Optimize for a 375px-wide phone before adding tablet or desktop enhancements.
- **Tournament workflow:** Tournament pages must make standings readable and match/result entry practical without horizontal scrolling.
- **Tables:** Dense ranking or result tables should turn into stacked cards or summaries on phone widths. Horizontal scroll is acceptable only as a desktop/tablet fallback, not as the main phone experience.
- **Forms:** Match-entry fields stack with visible labels, full-width inputs, and 44px minimum touch targets on phones.
- **Actions:** Page and section actions wrap to full-width buttons on phones so import, edit, add, save, and delete controls remain reachable.
- **Text:** Long player names, deck names, League names, and Tournament names must wrap inside cards instead of pushing the viewport wider.

### Event Calendar and Event Detail

The public event list (`/events`) and the event page (`/events/:slug`) carry four rules that are
design decisions, not component details:

- **Dim a past day with tone, never with `opacity`.** A past day cell darkens its background and
  drops its day number to Muted Steel at label weight. A blanket `opacity` drags the number under the
  contrast floor; the tint keeps it at AA (measured 5.49–5.62:1 across the cell tones). A test fails
  if an `opacity` rule reappears on the past-day selector.
- **A list card is one target.** An event card in the list is the link — the whole card, keyboard
  included. Controls that live inside it, such as the ICS export button, stop the click and the
  Enter/Space key so they never navigate as a side effect.
- **Matched search text is marked, not restyled.** Filtering highlights the matching run inside the
  title with an accent-tinted span. The card's own hierarchy does not change while the user types.
- **Month navigation keeps the reader's place.** Moving to the next or previous month must not scroll
  the page back to the top; the grid holds its height for the duration of the swap.

On the detail page the register action sits **beside** add-to-calendar rather than under it, and a
successful registration confirms in a dialog. The venue block links out to Google Maps from the
formatted address. Register is a creation action, so it is green — Create Green Hot rather than
Create Green, because the label is 14px and dark text on Create Green is only 4.04:1. Hover adds a
glow instead of shifting the background, which keeps both states above AA.

### League Cards

- **Purpose:** Large clickable destinations for opening Leagues.
- **Featured State:** The last consulted League can appear above the regular grid with stronger scale and placement.
- **Grid:** Three cards per row on full HD, two on medium screens, one on mobile.
- **Action:** Use a simple `View` button-style affordance inside the clickable card.
- **Hover:** Make the card feel bolder with a vivid red border, slightly darker surface, small lift, and stronger shadow.

## 6. Do's and Don'ts

### Do:

- **Do** use black, iron, blood-red, creation green, very dark delete red, and muted rust as the core visual vocabulary.
- **Do** keep pages low-density with large cards, large forms, and obvious actions.
- **Do** make surfaces more square than rounded, with complete rectangular borders.
- **Do** make the page recognizable as old-school trading-card tournament software on first impression.
- **Do** prioritize the last consulted League above the regular League grid when available.
- **Do** use familiar SaaS product structure for navigation, forms, cards, and page hierarchy.
- **Do** keep typography clean and product-oriented, with moderate weight and no cursive or decorative serif styling.

### Don't:

- **Don't** make the app flashy, neon, glowing, or animated for spectacle.
- **Don't** turn the old-school fantasy influence into copied card frames, fantasy illustration, or heavy ornament.
- **Don't** drift into generic SaaS cards with soft corners and neutral-only styling.
- **Don't** use dense spreadsheet-like pages when large cards or focused forms can communicate the same task.
- **Don't** make creation actions visually compete with opening an existing League.
- **Don't** use decorative side-stripe borders on cards or list items.
- **Don't** use double borders or inset borders on cards.
- **Don't** make the breadcrumb active state look like a button; only the current text should be highlighted.
- **Don't** put a kicker above a page title by default; only add one when the parent context is otherwise invisible.
