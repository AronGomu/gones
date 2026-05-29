# Use Browser Storage as the Temporary Source of Truth

Gones currently runs frontend-only, so browser `localStorage` is the temporary source of truth for League source data, Authorized Users, and the local session.

Consequences:

- Data is per-browser and per-device until the Nest.js backend exists.
- Gones Export/Gones Restore remain the official backup and portability mechanism.
- Organizer/Admin controls are local convenience permissions, not a server security boundary.
- The data-access boundary must stay behind `ApplicationBackend` so the future Nest.js adapter can become the canonical source without changing UI call sites.
