# Use a Frontend Backend Bridge

Gones now needs to run fully as a static frontend while leaving room for a later ASP.NET backend. We decided the Angular app will call an `ApplicationBackend` bridge instead of binding UI features to a concrete persistence provider.

Current implementation:

- `LocalFrontendBackend` stores Leagues in browser `localStorage`.
- UI components and repositories depend on the bridge contract, not direct HTTP or provider SDK calls.
- A `AspNetApiBackend` adapter defines the future HTTP boundary so the backend can be introduced without rewriting feature components.

This keeps the application functional offline from any hosted backend today while preserving a clean cutover path for server-owned persistence, jobs, integrations, and any future auth or permissions later.
