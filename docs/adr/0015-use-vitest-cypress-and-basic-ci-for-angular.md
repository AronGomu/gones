# Use Vitest, Cypress, and Basic CI for Angular

Gones is moving to Angular with TypeScript domain modules and Supabase-backed route flows. We decided to use Vitest for pure domain/unit tests, keep Cypress for browser-level user flows with Supabase/auth mocked at the app service boundary for MVP, and add basic GitHub Actions coverage for install, lint, build/typecheck, and Vitest tests. Cypress remains useful for local and focused E2E validation, while full Supabase/RLS E2E automation is deferred.
