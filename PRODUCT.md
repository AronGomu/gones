# Product

## Register

product

## Users

Gones serves tournament organizers and players through the same MVP interface.

Organizers use the app to create Leagues, add or update Tournament source data, import results, and preserve the data through exports. Players use the same screens to consult Leagues, Tournament Results, League Results, and Player Statistics. The primary device is a phone: users are expected to check a Tournament and enter or correct results from the event floor rather than from a desktop workstation.

There is no separate admin/player mode in the MVP. The interface must work for someone entering data and someone reading data without requiring different navigation or permissions.

## Product Purpose

Gones manages tournament results across Leagues so players and organizers can review standings, rounds, and Player Statistics.

The primary repeated workflow is opening an existing League, then adding, correcting, or consulting Tournament data. Creating a League is comparatively rare. A League can contain many Tournaments, often 10 to 20 or more, so returning to the right League quickly is more important than promoting creation.

Success means the app feels clear, direct, and hard to misread on an iPhone-sized screen first. Each page should show only the few controls and objects needed for the current task, with large touch-friendly elements, stacked forms, and ranking/result summaries that do not require horizontal panning on a phone.

## Brand Personality

Gones should feel simple, clear, and heavy.

The product can use familiar SaaS dashboard structure: headers, breadcrumbs, forms, cards, lists, and large buttons. Its first impression should still be old-school trading-card tournament software, especially old-school Magic-adjacent, without copying official card frames, art, symbols, or assets. Its character should come from dark material surfaces, blood-red accent color, subtle rust/metal cues, squared card-like containers, and old-school fantasy/card-game typography in headings.

The interface should not feel playful, flashy, crowded, or decorative. It should feel like a practical tournament tool with a darker, heavier identity.

## Anti-references

- Flashy gaming UI with neon effects, animated spectacle, or excessive glow.
- Bloated dashboards with too many panels, controls, filters, or competing metrics.
- Dense spreadsheet-like pages when a small set of large cards or forms would do.
- Heavy fantasy ornament, copied card frames, illustrated fantasy backgrounds, or decorative lore treatment.
- Generic SaaS surfaces without Gones' black, blood-red, rust, metal, and old-school trading-card character.
- Mobile-app toy feeling: rounded, soft, playful, or oversized in a way that reduces seriousness.

## Design Principles

1. **Open the current object fast.** The most important repeated action is returning to the relevant League, especially the last consulted League.
2. **Few objects, large targets.** Pages should contain only the controls and data needed for the current workflow, with large cards, buttons, and form fields.
3. **Phone-first structure.** The same UI should fit neatly on a phone before expanding into wider desktop layouts. Tournament checking and result entry are the primary mobile workflows, so tables must become cards or stacked summaries on phone widths.
4. **SaaS structure, card-game identity.** Use familiar product patterns, but make the first impression feel like old-school trading-card tournament software.
5. **Character without clutter.** Use old-school fantasy influence mainly through headings and material tone, not through ornament or visual noise.

## Accessibility & Inclusion

Accessibility is not a primary design driver for the MVP.

Still, future implementation should avoid obviously fragile defaults where practical: keep text readable, keep controls large enough for touch, preserve keyboard focus states, and avoid using red alone when a state label can also communicate the meaning.
