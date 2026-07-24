# Use Vitest, Cypress, and Basic CI for Angular

Gones uses Angular with TypeScript domain modules and backend-bridge route flows. We decided to use Vitest for pure domain/unit tests, keep Cypress for browser-level user flows against the frontend-only app, and add basic GitHub Actions coverage for install, lint, build/typecheck, and Vitest tests. When the ASP.NET backend is added, integration tests should cover the bridge contract at the HTTP boundary.
