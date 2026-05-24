# Frontend Deployment Guide

This project is an Angular single-page PWA backed by Supabase. The frontend can be deployed as static files; it does **not** need a Node server online.

The recommended host for this repository is **Cloudflare Pages**.

## What gets deployed

- Build command: `npm run build`
- Production output directory: `dist/gones/browser`
- Runtime backend: Supabase hosted project
- Public frontend config required at build time:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`

> The Supabase anon key is safe to ship to the browser when Row Level Security is correctly configured. Never put a Supabase service-role key in the Angular app or Cloudflare Pages frontend variables.

## 1. Prepare Supabase first

Before deploying the frontend, create or link a hosted Supabase project and apply the database schema.

From the repository root:

```bash
supabase login
supabase orgs list
supabase projects create gones --org-id <org-id> --db-password <database-password> --region <region>
supabase projects list
supabase link --project-ref <project-ref> --password <database-password>
supabase db push --linked
```

Add the first Admin User:

```bash
supabase db query --linked "insert into public.authorized_users (email, role, created_by_email, updated_by_email) values (lower('<admin-google-email>'), 'admin', 'cli', 'cli') on conflict (email) do update set role = 'admin', updated_by_email = 'cli';"
```

Get the values needed by the Angular app:

```bash
supabase projects api-keys --project-ref <project-ref>
```

Copy:

- the project URL, for `SUPABASE_URL`
- the anon/public key, for `SUPABASE_ANON_KEY`

## 2. Configure Google OAuth redirects

After you know your deployed frontend URL, configure Supabase Auth so Google sign-in can return to the app.

For a Cloudflare Pages URL like:

```text
https://gones.pages.dev
```

Supabase Auth should allow:

```text
https://gones.pages.dev
https://gones.pages.dev/login
```

If you later attach a custom domain, also add:

```text
https://your-domain.example
https://your-domain.example/login
```

Keep the local URLs for development if you still use local Supabase:

```text
http://127.0.0.1:4200
http://127.0.0.1:4200/login
http://localhost:4200/login
```

## 3. Deploy with Cloudflare Pages

1. Push this repository to GitHub.
2. In Cloudflare, go to **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
3. Select the GitHub repository.
4. Use these build settings:

| Setting | Value |
| --- | --- |
| Framework preset | Angular, or None if you enter settings manually |
| Build command | see below |
| Build output directory | `dist/gones/browser` |
| Root directory | leave blank |
| Node version | `24` |

Add a Cloudflare Pages environment variable:

```text
NODE_VERSION=24
```

Add these Cloudflare Pages environment variables for Production, and usually Preview too:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
```

Because Angular embeds environment values at build time, use this build command so Cloudflare writes `src/environments/environment.prod.ts` during the build:

```bash
node -e "const fs=require('fs'); const env={production:true,supabaseUrl:process.env.SUPABASE_URL||'',supabaseAnonKey:process.env.SUPABASE_ANON_KEY||'',appVersion:(process.env.CF_PAGES_COMMIT_SHA||'0.1.0').slice(0,7)}; fs.writeFileSync('src/environments/environment.prod.ts','export const environment = '+JSON.stringify(env,null,2)+';\n');" && npm ci && npm run build
```

Then click **Save and Deploy**.

## 4. Verify the deployment

Open the deployed URL and check:

1. `/leagues` loads without console errors.
2. Public visitors can view public League data.
3. Google sign-in redirects back to `/login` on the deployed domain.
4. Unknown signed-in users still behave like visitors.
5. Organizer/Admin users can edit League data.
6. Admin users can open `/admin/users`.
7. Refreshing a nested route still loads the Angular app.

## 5. If direct route refreshes 404

Angular routes such as `/leagues` and `/admin/users` need a static-host fallback to `index.html`.

If Cloudflare Pages does not handle this automatically, add a `_redirects` file to the built site with this content:

```text
/* /index.html 200
```

For this Angular project, that means adding `src/_redirects` and including it in the `assets` array in `angular.json` so it is copied to `dist/gones/browser/_redirects`.

## 6. Local production build check

Before deploying, you can check the production build locally:

```bash
npm ci
npm run lint
npm run test
npm run build
```

The built frontend will be in:

```text
dist/gones/browser
```

## 7. Common mistakes

- Do not deploy before the hosted Supabase schema and first Admin User exist.
- Do not use the local Supabase URL from `supabase start` in production.
- Do not put the Supabase service-role key in frontend configuration.
- Remember that Cloudflare Pages environment variables are baked into the Angular bundle at build time.
- If you change Supabase values, trigger a fresh Cloudflare Pages deployment.
