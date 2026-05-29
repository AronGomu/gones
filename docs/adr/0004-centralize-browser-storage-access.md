# Centralize Browser Storage Access

Status: superseded by [ADR 0008](./0008-use-browser-store-as-temporary-source-of-truth.md) for the Angular frontend-only bridge.

Gones pages should not read and write `localStorage` directly. Browser storage access belongs behind the application backend bridge, while domain modules remain unaware of persistence and pages focus on interaction and rendering. Local storage should use the same versioned data contract as Gones Export so persistence, export, restore, and future migrations share one shape.
