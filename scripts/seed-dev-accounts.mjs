#!/usr/bin/env node
/**
 * Seed the fixed local development accounts (ADR 0029).
 *
 * `npm run dev` used to bring up an empty user table, so the first sign-in could only ever answer
 * 401. This creates `admin@gones.test` and `test@gones.test` through the real registration endpoint —
 * so they carry a genuine Identity password hash — and then confirms the email and writes the global
 * role with SQL against the local Compose database. `migrator admin bootstrap` cannot be used: its
 * one-shot marker row makes it unusable from a re-runnable seeder.
 *
 * Idempotent by design: the existence probe means a re-run spends no auth rate-limit permit, and the
 * SQL converges instead of conflicting.
 */
import { spawnSync } from 'node:child_process';

import { DEV_ACCOUNTS } from './dev-accounts.mjs';

const API_ORIGIN = 'http://127.0.0.1:5080';

function psql(sql, { capture = false } = {}) {
  const result = spawnSync('docker', [
    'compose', 'exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones',
    '-v', 'ON_ERROR_STOP=1', capture ? '-tAc' : '-c', sql
  ], { encoding: 'utf8', stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit' });
  if (result.status !== 0) {
    console.error('Dev account seeding could not reach the local database. Is the stack up? (docker compose ps postgres)');
    process.exit(result.status ?? 1);
  }
  return result;
}

for (const { email, username, password, firstName, lastName } of DEV_ACCOUNTS) {
  const probe = psql(`SELECT 1 FROM asp_net_users WHERE normalized_email = '${email.toUpperCase()}' LIMIT 1`, { capture: true });
  if (probe.stdout.trim() === '1') continue;

  const response = await fetch(`${API_ORIGIN}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, username, password, firstName, lastName })
  });
  if (!response.ok && response.status !== 409) {
    console.error(`Dev account registration failed for ${email}: ${response.status} ${await response.text()}`);
    process.exit(1);
  }
}

psql(DEV_ACCOUNTS.map(({ email, role }) => `UPDATE asp_net_users SET email_confirmed = true, global_role = '${role}', lockout_end = NULL, access_failed_count = 0 WHERE normalized_email = '${email.toUpperCase()}';`).join('\n'));

console.log('Seeded dev accounts: admin@gones.test (Admin), test@gones.test (User). Password: Gones-dev-pass-123!');
