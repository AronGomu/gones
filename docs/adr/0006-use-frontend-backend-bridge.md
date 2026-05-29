# Use a Frontend Backend Bridge

Gones now needs to run fully as a static frontend while leaving room for a later Nest.js backend. We decided the Angular app will call an `ApplicationBackend` bridge instead of binding UI features to a concrete persistence provider.

Current implementation:

- `LocalFrontendBackend` stores Leagues, Authorized Users, and the local session in browser `localStorage`.
- UI components and repositories depend on the bridge contract, not direct HTTP or provider SDK calls.
- A `NestApiBackend` adapter defines the future HTTP boundary so the backend can be introduced without rewriting feature components.

This keeps the application functional offline from any hosted backend today while preserving a clean cutover path for server-owned auth, permissions, persistence, jobs, and integrations later.
