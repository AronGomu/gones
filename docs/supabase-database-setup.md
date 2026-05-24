# Supabase Database Setup

This guide sets up the Supabase database for Gones using Supabase CLI commands for every Supabase operation.

Run commands from the repository root.

## 1. Install prerequisites

- Node.js and npm, for the Angular project dependencies
- Docker Desktop, for local Supabase
- Supabase CLI, available as `supabase`

## 2. Start local Supabase

```bash
npm run supabase start
npm run supabase status -o env
```

This uses `supabase/config.toml` and starts the local Supabase stack.

## 3. Apply the local schema and seed data

```bash
npm run supabase db reset
```

This applies:

- `supabase/migrations/0001_initial_schema.sql`
- `supabase/seed.sql`

The seed creates:

- one local Admin User: `neverismine@gmail.com`
- one Demo League

## 4. Add or replace the first Admin User with the CLI

For a local database, upsert the real lowercase Google email that should be an Admin User:

```bash
npm run supabase db query --local "insert into public.authorized_users (email, role, created_by_email, updated_by_email) values (lower('<admin-google-email>'), 'admin', 'cli', 'cli') on conflict (email) do update set role = 'admin', updated_by_email = 'cli';"
```

For a linked hosted project, use the same upsert against the remote database:

```bash
npm run supabase db query --linked "insert into public.authorized_users (email, role, created_by_email, updated_by_email) values (lower('<admin-google-email>'), 'admin', 'cli', 'cli') on conflict (email) do update set role = 'admin', updated_by_email = 'cli';"
```

## 5. Create or link a hosted Supabase project

Authenticate and find the organization ID:

```bash
npm run supabase login
npm run supabase orgs list
```

Create a hosted project if one does not already exist:

```bash
npm run supabase projects create gones --org-id <org-id> --db-password <database-password> --region <region>
```

Find the project ref, then link this repository to the hosted project:

```bash
npm run supabase projects list
npm run supabase link --project-ref <project-ref> --password <database-password>
```

## 6. Push the schema to the hosted project

Preview the pending migrations first:

```bash
npm run supabase db push --linked --dry-run
```

Apply the migrations:

```bash
npm run supabase db push --linked
```

Then run the linked-project Admin User upsert from step 4.

If `supabase/seed.sql` has been updated for the correct hosted Admin User and you intentionally want the demo data on the hosted project, apply migrations and seed together instead:

```bash
npm run supabase db push --linked --include-seed
```

## 7. Configure Google OAuth from CLI-managed config

`supabase/config.toml` contains the Auth site URL, redirect URLs, and Google provider settings. After the Google provider values are set for the config placeholders, push the config to the hosted project:

```bash
npm run supabase config push --project-ref <project-ref>
```

For local development, restart the local stack after changing Auth config:

```bash
npm run supabase stop
npm run supabase start
```

## 8. Get app configuration values with the CLI

For local development, print the local Supabase URL and anon key:

```bash
npm run supabase status -o env
```

For a hosted project, list the project API keys:

```bash
npm run supabase projects api-keys --project-ref <project-ref>
```

Copy only the Supabase URL and anon key into the Angular environment. Do **not** put the service-role key in the Angular app.

## 9. Verify Row Level Security with the CLI

List the public policies:

```bash
npm run supabase db query --local "select schemaname, tablename, policyname, roles, cmd from pg_policies where schemaname = 'public' order by tablename, policyname;"
```

Run Supabase's local advisors:

```bash
npm run supabase db advisors --local --type security --level warn
```

For a linked hosted project, run the same checks remotely:

```bash
npm run supabase db query --linked "select schemaname, tablename, policyname, roles, cmd from pg_policies where schemaname = 'public' order by tablename, policyname;"
npm run supabase db advisors --linked --type security --level warn
```

Manually confirm these behavior rules from the policy output and app sign-in flows:

- Visitors can read `public_leagues`.
- Visitors cannot insert, update, or delete `leagues`.
- Unknown signed-in Google users behave like Visitors.
- Organizer/Admin users can modify League documents.
- Only Admin users can manage `authorized_users`.
- The last Admin User cannot be removed or downgraded.
