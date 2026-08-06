# Use Browser Storage as the Temporary Source of Truth

Gones currently runs frontend-only, so browser `localStorage` is the temporary source of truth for League source data.

Consequences:

- Data is per-browser and per-device until the ASP.NET backend exists.
- Gones Export/Gones Restore remain the official backup and portability mechanism.
- Edit controls are browser-local MVP conveniences, not a server security boundary.
- Admin and Organizer remain design concepts for a later backend-backed version, but they do not drive MVP access control.
- The data-access boundary must stay behind `ApplicationBackend` so the future ASP.NET adapter can become the canonical source without changing UI call sites.

**Amended by ADR 0019 (C42).** This decision now describes the `legacy-browser` mode only, and that
mode is frozen: no new Calendar V1, auth or admin capability may be added to it. In `server` mode the
API database is the single authority and the browser holds nothing canonical. The Gones
Export/Restore path and the private migration bundle remain the only route off a legacy origin, and
stay in place until a public cutover plus soak authorizes their removal.
