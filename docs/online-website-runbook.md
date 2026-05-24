# Online Website Runbook

Use this checklist to get Gones running online from this repository.

## Goal

- Host the Angular PWA as static files on Cloudflare Pages.
- Use the hosted Supabase project as the online backend.
- Keep secrets out of the browser bundle. Only the Supabase URL and anon/public key belong in frontend configuration.

## 1. Verify local build health

From the repository root:

```bash
npm ci
npm run lint
npm run test
npm run build
```

Expected production build output:

```text
dist/gones/browser
```

## 2. Prepare the hosted Supabase project

Log in and confirm the hosted project:

```bash
npm run supabase login
npm run supabase projects list
```

This checkout is currently linked to Supabase project ref:

```text
yidfdolincawzxquyjfn
```

If you need to relink to a different hosted project:

```bash
npm run supabase link --project-ref <project-ref> --password <database-password>
```

Preview and apply the schema migrations:

```bash
npm run supabase db push --linked --dry-run
npm run supabase db push --linked
```

Create or update the first Admin User. Use the real lowercase Google email that should administer the site:

```bash
npm run supabase db query --linked "insert into public.authorized_users (email, role, created_by_email, updated_by_email) values (lower('<admin-google-email>'), 'admin', 'cli', 'cli') on conflict (email) do update set role = 'admin', updated_by_email = 'cli';"
```

## 3. Get frontend Supabase values

Fetch hosted project API values:

```bash
npm run supabase projects api-keys --project-ref yidfdolincawzxquyjfn
```

Copy only these values for Cloudflare Pages:

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon-public-key>
```

Do **not** copy the service-role key into Cloudflare Pages frontend variables or Angular environment files.

## 4. Configure Google OAuth in Supabase

In the Supabase dashboard for the hosted project:

1. Enable/configure the Google Auth provider.
2. Set the production Site URL after Cloudflare gives you the deployed URL.
3. Add allowed redirect URLs for the deployed site.

For the default Cloudflare Pages URL, allow:

```text
https://<cloudflare-project>.pages.dev
https://<cloudflare-project>.pages.dev/login
```

If a custom domain is attached, also allow:

```text
https://<your-domain>
https://<your-domain>/login
```

Keep local redirects if local development is still used:

```text
http://127.0.0.1:4200
http://127.0.0.1:4200/login
http://localhost:4200/login
```

## 5. Push the repository to GitHub

Commit and push the current branch before connecting Cloudflare Pages:

```bash
git status
git add .
git commit -m "Prepare Angular Supabase deployment"
git push -u origin <branch-name>
```

If the branch already tracks a remote branch, use:

```bash
git push
```

## 6. Create the Cloudflare Pages deployment

In Cloudflare:

1. Go to **Workers & Pages**.
2. Choose **Create application**.
3. Choose **Pages**.
4. Choose **Connect to Git**.
5. Select this GitHub repository.
6. Use these build settings.

| Setting | Value |
| --- | --- |
| Framework preset | Angular, or None if entering manually |
| Root directory | leave blank |
| Build output directory | `dist/gones/browser` |
| Node version | `24` |

Set this environment variable:

```text
NODE_VERSION=24
```

Set these Cloudflare Pages environment variables for Production, and usually Preview too:

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon-public-key>
```

Use this Cloudflare build command so Angular receives the Supabase values at build time:

```bash
node -e "const fs=require('fs'); const env={production:true,supabaseUrl:process.env.SUPABASE_URL||'',supabaseAnonKey:process.env.SUPABASE_ANON_KEY||'',appVersion:(process.env.CF_PAGES_COMMIT_SHA||'0.1.0').slice(0,7)}; fs.writeFileSync('src/environments/environment.prod.ts','export const environment = '+JSON.stringify(env,null,2)+';\n');" && npm ci && npm run build
```

Click **Save and Deploy**.

## 7. Verify the live website

Open the Cloudflare Pages URL and check:

1. The home route loads.
2. `/leagues` loads without console errors.
3. Public visitors can view public League data.
4. Google sign-in redirects back to `/login` on the deployed domain.
5. Unknown signed-in Google users still behave like visitors.
6. Organizer/Admin users can edit League data.
7. Admin users can open `/admin/users`.
8. Refreshing a nested route still loads the Angular app.

## 8. Fix direct-route refreshes if needed

If refreshing `/leagues` or `/admin/users` returns a Cloudflare 404, add a static host fallback to `index.html`:

```text
/* /index.html 200
```

For this Angular project, add that content as `src/_redirects` and include it in the `assets` array in `angular.json` so it is copied to:

```text
dist/gones/browser/_redirects
```

## 9. After deployment changes

When changing Supabase URL, anon key, OAuth redirects, or app build configuration:

1. Update Cloudflare Pages environment variables or Supabase settings.
2. Trigger a fresh Cloudflare Pages deployment.
3. Re-run the live verification checklist.

## 10. Optional: use Supabase MCP from Pi

This repository includes `.mcp.json` for Pi MCP access:

- `supabase`: hosted Supabase MCP, project-scoped and read-only.
- `supabase-local`: local Supabase CLI MCP at `http://localhost:54321/mcp`.

After installing/reloading Pi MCP support, authenticate with:

```text
/mcp-auth supabase
```

Then you can ask Pi to inspect the Supabase database using MCP tools.
