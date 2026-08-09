# T1: Dev accounts and refresh-cookie topology

**Plan:** `./ai-artifacts/PLAN_2026_08_09_feedback-calendar-v1-round-2.md`
**Depends:** none
**Commit outcome:** `npm run dev` brings up the stack, seeds two verified dev accounts, and a browser signed in as `admin@gones.test` stays signed in across a page reload.

## Context (self-contained)

- Goal: land round-2 feedback on Gones (Angular 21 SPA + ASP.NET API + PostgreSQL, all in `compose.yaml`).
- This slice: feedback line 10 — "Even though I launch using `npm run dev`, the application cannot connect with either the admin account or the test account. I get a 401 error." This is the first ticket because every later ticket needs a working local login to validate against.
- Out of scope here: any `backend/src/**/*.cs` change, release/production compose files, UI changes of any kind.
- Assumptions in force: **A9** — accounts are fixed and hardcoded (`admin@gones.test`, `test@gones.test`, both `Gones-dev-pass-123!`, both email-verified). Admin role is granted by direct SQL, **not** by `migrator admin bootstrap`.

### The two defects, already diagnosed — do not re-investigate

1. **No account exists.** `npm run dev` runs `scripts/dev.mjs`, which only does `docker compose up -d --wait postgres migrator api worker` then `ng serve`. Neither it nor `npm run db:seed` (`scripts/seed-local.mjs` → `migrator database seed`) ever creates a user row. `POST /api/auth/login` (`backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs`, `LoginAsync`) therefore reaches `userManager.FindByEmailAsync(...) is null` and throws `AuthenticationFailedException` → **401 `invalid_credentials`**. Correct behaviour; the accounts simply do not exist.
2. **The refresh cookie is dropped.** `compose.yaml` runs the `api` service with `ASPNETCORE_ENVIRONMENT: Production`, so `backend/src/Gones.Api/appsettings.Development.json` (which sets `Gones:Auth:RefreshCookie:Secure = false`) is never loaded. `RefreshCookieOptions` (`backend/src/Gones.Infrastructure/Identity/RefreshCookieOptions.cs`) then defaults `Secure = true`. The browser refuses to store a `Secure` cookie delivered over plain `http://127.0.0.1:5080`, so `gones_refresh` never lands, `AuthService.bootstrap()` calls `POST /api/auth/refresh` on the next load, and that answers **401** too.

Both must be fixed. Fixing only (1) leaves the user signed out on every reload.

### Why not `migrator admin bootstrap`

`backend/src/Gones.Infrastructure/Identity/AdminBootstrapService.cs` locks a one-shot marker row: once consumed, a second call returns `AlreadyConsumed` and promotes nobody. A dev database that has been bootstrapped once can never bootstrap another address. A dev seeding script must be idempotent and re-runnable, so it writes the role with SQL instead. The column is `asp_net_users.global_role`, constrained by `ck_asp_net_users_global_role` to `('User', 'Organizer', 'Admin')`.

## Requirements

- A new script seeds `admin@gones.test` (role `Admin`) and `test@gones.test` (role `User`), both with `email_confirmed = true`, both with password `Gones-dev-pass-123!`.
- The script is idempotent: running it twice is a no-op and never burns an auth rate-limit permit for an account that already exists.
- `npm run dev` runs it automatically after the API reports ready, and offers `--no-accounts` to skip.
- The local `api` service sets the refresh cookie to `SameSite=Lax; Secure=false` so a plain-HTTP dev host keeps the session.
- Release compose files are untouched and keep the secure default.
- The credentials and the password policy are covered by a deterministic unit test that needs no Docker.

## Inputs

- `scripts/dev.mjs` — current dev launcher; parses `--no-docker` / `--detached`, calls `waitForApi()`, then spawns `npx ng serve`.
- `scripts/seed-auth-e2e.mjs` — the existing pattern to copy: `docker compose exec -T postgres psql -U gones_migration -d gones -tAc "SELECT 1 FROM asp_net_users WHERE normalized_email = '…'"` for the existence probe, `fetch('http://127.0.0.1:5080/api/auth/register', …)` to create, then `psql … -c "UPDATE …"` to verify the email.
- `compose.yaml` — the `api` service `environment:` block (currently ends with `OTEL_EXPORTER_OTLP_ENDPOINT`).
- `.env.example` — already documents `GONES__AUTH__REFRESHCOOKIE__SAMESITE` and `GONES__AUTH__REFRESHCOOKIE__SECURE` and states "localhost/127.0.0.1 must set SECURE=false or the cookie is never stored".
- `ops/` — existing vitest suites (`host-contract.test.ts`, `frontend-data-authority.test.ts`) that read repo files and assert on their text. Same harness, same style.
- **From Depends:** none.

## TDD

1. **Red** — write `ops/dev-accounts.test.ts` first. It imports `DEV_ACCOUNTS` and `meetsPasswordPolicy` from `scripts/dev-accounts.mjs` (which does not exist yet) and reads `compose.yaml`, `scripts/dev.mjs` and `package.json` as text. Run `npx vitest run ops/dev-accounts.test.ts` and watch it fail on the missing module.
2. **Green** — add `scripts/dev-accounts.mjs`, `scripts/seed-dev-accounts.mjs`, the `compose.yaml` env lines, the `dev.mjs` hook and the `package.json` script until the suite passes.
3. **Refactor** — only if needed. Keep green.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `every dev account password meets the server policy` | each `DEV_ACCOUNTS` entry | `meetsPasswordPolicy(account.password) === true` |
| `password policy rejects a short or weak password` | `'short'`, `'alllowercase1!'`, `'NOLOWERCASE1!'`, `'NoDigitsHere!!'`, `'NoSymbols12345'` | `meetsPasswordPolicy(...) === false` for every one |
| `seeds exactly one Admin and one plain User` | `DEV_ACCOUNTS` | emails are `['admin@gones.test', 'test@gones.test']`; roles are `['Admin', 'User']` |
| `every dev account role is an accepted global role` | each entry | `['User', 'Organizer', 'Admin']` contains `account.role` |
| `local compose relaxes the refresh cookie for plain http` | `compose.yaml` text | matches `/GONES__AUTH__REFRESHCOOKIE__SECURE:\s*\$\{GONES__AUTH__REFRESHCOOKIE__SECURE:-false\}/` and `/GONES__AUTH__REFRESHCOOKIE__SAMESITE:\s*\$\{GONES__AUTH__REFRESHCOOKIE__SAMESITE:-Lax\}/` |
| `release compose never defaults the cookie insecure` | `compose.release-candidate.yaml` + `compose.release-test.yaml` text | neither contains `REFRESHCOOKIE__SECURE:-false` |
| `npm run dev seeds the dev accounts` | `scripts/dev.mjs` text | contains `seed-dev-accounts.mjs` and contains `--no-accounts` |
| `package.json exposes the seeding script` | parsed `package.json` | `scripts['dev:accounts'] === 'node scripts/seed-dev-accounts.mjs'` |
| `the seeding script verifies the email and writes the role` | `scripts/seed-dev-accounts.mjs` text | contains `email_confirmed = true` and contains `global_role` |

## Impl steps

- [ ] 1. Create `ops/dev-accounts.test.ts` with the nine tests above. Import shape: `import { DEV_ACCOUNTS, meetsPasswordPolicy } from '../scripts/dev-accounts.mjs';`. Read files with `readFileSync(join(__dirname, '..', '<name>'), 'utf8')`.
- [ ] 2. Run `npx vitest run ops/dev-accounts.test.ts` — it must fail (module not found).
- [ ] 3. Create `scripts/dev-accounts.mjs` exporting exactly:
      ```js
      export const DEV_PASSWORD = 'Gones-dev-pass-123!';
      export const DEV_ACCOUNTS = [
        { email: 'admin@gones.test', username: 'gones-admin', firstName: 'Gones', lastName: 'Admin', role: 'Admin', password: DEV_PASSWORD },
        { email: 'test@gones.test', username: 'gones-test', firstName: 'Gones', lastName: 'Test', role: 'User', password: DEV_PASSWORD }
      ];
      export function meetsPasswordPolicy(password) {
        return typeof password === 'string'
          && password.length >= 12
          && /[a-z]/.test(password)
          && /[A-Z]/.test(password)
          && /\d/.test(password)
          && /[^A-Za-z0-9]/.test(password);
      }
      ```
- [ ] 4. Create `scripts/seed-dev-accounts.mjs`. Header comment must name ADR 0029. Body, in order:
      a. `import { DEV_ACCOUNTS } from './dev-accounts.mjs';`
      b. `function psql(sql, { capture = false } = {})` wrapping `spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-v', 'ON_ERROR_STOP=1', capture ? '-tAc' : '-c', sql], { encoding: 'utf8', stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit' })`; exit with the child status on failure.
      c. For each account: probe `SELECT 1 FROM asp_net_users WHERE normalized_email = '<EMAIL UPPERCASED>' LIMIT 1`. If the trimmed stdout is not `1`, `await fetch('http://127.0.0.1:5080/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, username, password, firstName, lastName }) })` and accept `response.ok || response.status === 409`; anything else prints the status plus body and exits 1.
      d. After the loop, one SQL statement per account: `UPDATE asp_net_users SET email_confirmed = true, global_role = '<role>', lockout_end = NULL, access_failed_count = 0 WHERE normalized_email = '<EMAIL UPPERCASED>';`
      e. `console.log('Seeded dev accounts: admin@gones.test (Admin), test@gones.test (User). Password: Gones-dev-pass-123!');`
- [ ] 5. In `package.json` `scripts`, add `"dev:accounts": "node scripts/seed-dev-accounts.mjs"` immediately after `"dev:serve"`.
- [ ] 6. In `compose.yaml`, in the `api` service `environment:` block, add two lines directly above `GONES_OTEL_CONSOLE_EXPORTER`:
      ```yaml
      GONES__AUTH__REFRESHCOOKIE__SAMESITE: ${GONES__AUTH__REFRESHCOOKIE__SAMESITE:-Lax}
      GONES__AUTH__REFRESHCOOKIE__SECURE: ${GONES__AUTH__REFRESHCOOKIE__SECURE:-false}
      ```
      Add a one-line comment above them: `# Plain-http dev host: a Secure cookie is silently dropped, so the session never survives a reload (ADR 0029).`
- [ ] 7. In `scripts/dev.mjs`: add `const skipAccounts = argv.includes('--no-accounts');` next to `skipDocker`; add `'--no-accounts'` to the `ngArgs` filter list; extend the flags block comment with `--no-accounts  skip the dev-account seeding step`.
- [ ] 8. In `scripts/dev.mjs`, immediately after the `await waitForApi();` call inside the `if (!skipDocker)` branch, add:
      ```js
      if (!skipAccounts) {
        const seeded = spawnSync(process.execPath, ['scripts/seed-dev-accounts.mjs'], { stdio: 'inherit' });
        if (seeded.status !== 0) fail('Dev account seeding failed. Re-run it with: npm run dev:accounts');
      }
      ```
- [ ] 9. In `AGENT.md`, in the `## Commands` fenced block, add `npm run dev:accounts        # re-seed admin@gones.test / test@gones.test (password Gones-dev-pass-123!)` under `npm run dev -- --no-docker`.
- [ ] 10. In `README.md`, under the local development section, add a short "Dev accounts" note listing both addresses, the shared password, and that they exist only in the local Compose database.
- [ ] 11. Run `npx vitest run ops/dev-accounts.test.ts` — green.

## Outputs

- New: `scripts/dev-accounts.mjs`, `scripts/seed-dev-accounts.mjs`, `ops/dev-accounts.test.ts`.
- Changed: `scripts/dev.mjs`, `package.json`, `compose.yaml`, `AGENT.md`, `README.md`.
- Behaviour: `npm run dev` gains an account-seeding step and a `--no-accounts` flag; the local API issues a non-`Secure`, `SameSite=Lax` refresh cookie.
- Config: `GONES__AUTH__REFRESHCOOKIE__SAMESITE` and `GONES__AUTH__REFRESHCOOKIE__SECURE` are now honoured by the local stack and default to `Lax` / `false` there only.

## Validation

- [ ] `npm run test` passes
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] Manual: `docker compose down -v && npm run dev`, then at `http://127.0.0.1:4200/login` sign in with `admin@gones.test` / `Gones-dev-pass-123!` — no 401, the toolbar shows the username.
- [ ] Manual: reload the page — still signed in (this is the cookie fix). In DevTools → Application → Cookies, `gones_refresh` is present and **not** marked Secure.
- [ ] Manual: sign in with `test@gones.test` / `Gones-dev-pass-123!` — succeeds, and no admin-only navigation is offered.
- [ ] Manual: `npm run dev:accounts` a second time — exits 0, prints the summary line, creates nothing new.
- [ ] app functional — no broken path from this slice
- [ ] commit msg draft: `fix(dev): seed local accounts and stop dropping the refresh cookie over http`
