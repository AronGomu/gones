# Use a Frontend Backend Bridge

Gones now needs to run fully as a static frontend while leaving room for a later ASP.NET backend. We decided the Angular app will call an `ApplicationBackend` bridge instead of binding UI features to a concrete persistence provider.

Current implementation:

- `LocalFrontendBackend` stores Leagues in browser `localStorage`.
- UI components and repositories depend on the bridge contract, not direct HTTP or provider SDK calls.
- A `AspNetApiBackend` adapter defines the future HTTP boundary so the backend can be introduced without rewriting feature components.

This keeps the application functional offline from any hosted backend today while preserving a clean cutover path for server-owned persistence, jobs, integrations, and any future auth or permissions later.

**Amended by ADR 0019 (C42).** The bridge is no longer a runtime fallback. A build declares one
authority — `legacy-browser` or `server` — and the bridge binds to exactly one adapter for that
build. `LocalFrontendBackend` is not injectable in server mode, and `AspNetApiBackend` no longer
carries the whole-document or CalendarEvent methods that only ever wrote the browser store.
