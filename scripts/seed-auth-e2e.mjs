import { spawnSync } from 'node:child_process';

const email = 'cypress.user@example.test';

// Registration only spends a rate-limit permit the very first time the fixture user is created —
// every later run just gets a 409, which we already tolerate below. Check first so re-runs of this
// script (and every Cypress ticket that seeds before its spec) do not burn an auth permit for nothing.
const existsCheck = spawnSync('docker', [
  'compose', 'exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones',
  '-tAc', "SELECT 1 FROM asp_net_users WHERE normalized_email = 'CYPRESS.USER@EXAMPLE.TEST' OR user_name = 'cypress-user' LIMIT 1"
], { encoding: 'utf8' });
if (existsCheck.status !== 0) {
  console.error(`Auth seed existence check failed: ${existsCheck.stderr}`);
  process.exit(existsCheck.status ?? 1);
}
const userExists = existsCheck.stdout.trim() === '1';

if (!userExists) {
  const response = await fetch('http://127.0.0.1:5080/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, username: 'cypress-user', password: 'Cypress-pass-123!', firstName: 'Cypress', lastName: 'User' })
  });
  if (!response.ok && response.status !== 409) {
    console.error(`Auth seed registration failed: ${response.status} ${await response.text()}`);
    process.exit(1);
  }
}
const sql = `
UPDATE asp_net_users
SET email = '${email}',
    normalized_email = 'CYPRESS.USER@EXAMPLE.TEST',
    email_confirmed = true
WHERE normalized_email IN ('CYPRESS.USER@EXAMPLE.TEST', 'CYPRESS.USER+CHANGED@EXAMPLE.TEST')
   OR user_name = 'cypress-user';

UPDATE user_profiles
SET location_country = NULL,
    location_region = NULL,
    location_city = NULL,
    birth_date = NULL,
    preferred_language = 'en',
    is_first_name_public = false,
    is_last_name_public = false,
    is_location_public = false,
    is_birth_date_public = false,
    is_preferred_language_public = false
WHERE user_id IN (
  SELECT id FROM asp_net_users WHERE normalized_email = 'CYPRESS.USER@EXAMPLE.TEST' OR user_name = 'cypress-user'
);

DELETE FROM external_identities
WHERE user_id IN (
  SELECT id FROM asp_net_users WHERE normalized_email = 'CYPRESS.USER@EXAMPLE.TEST' OR user_name = 'cypress-user'
);

DELETE FROM refresh_sessions
WHERE user_id IN (
  SELECT id FROM asp_net_users WHERE normalized_email = 'CYPRESS.USER@EXAMPLE.TEST' OR user_name = 'cypress-user'
);
`;
const result = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Seeded verified Cypress auth user.');
