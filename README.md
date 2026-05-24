# Gones

Gones is an Angular single-page PWA for consulting tournament League results, exporting Gones source-data backups, and letting authorized Organizer/Admin users edit League source data through Supabase.

## Stack

- Angular standalone components, Angular Router, Signals, zoneless change detection
- Angular Material UI with Gones dark metal / blood-red theme tokens
- Supabase Auth, PostgreSQL, RLS, and local Supabase CLI config
- Vitest for domain/unit tests
- Cypress for browser flows with app-service/auth boundaries mocked for MVP
- Cloudflare Pages static hosting

## Local setup

```bash
npm install
npm run dev
```

The app runs at `http://127.0.0.1:4200`.

## Supabase setup

Local CLI setup:

```bash
npm run supabase:start
npm run supabase:reset
```

The schema lives in `supabase/migrations/0001_initial_schema.sql` and seed data lives in `supabase/seed.sql`.

Before using a shared Supabase project:

1. Create a Supabase project.
2. Apply the SQL migration.
3. Insert the first real lowercase Admin User email using setup SQL/seed data.
4. Configure Google OAuth in Supabase Auth.
5. Copy Supabase URL and anon key into the Angular environment used by your deployment.
6. Manually verify RLS:
   - unauthenticated visitors can select from `public_leagues`;
   - visitors cannot insert/update/delete `leagues`;
   - unknown signed-in Google users behave like visitors;
   - Organizer/Admin users can modify League documents;
   - only Admin users can manage `authorized_users`;
   - the last Admin User cannot be removed or downgraded.

No service-role key belongs in the Angular app.

## Commands

```bash
npm run build
npm run lint
npm run test
npm run cy:run
```

## Data portability

Gones Export is JSON source-data backup only. League Export uses `kind: "league"`; Full Data Export uses `kind: "fullData"`. Direct browser `localStorage` migration is intentionally not implemented; use Gones Restore paths instead.
