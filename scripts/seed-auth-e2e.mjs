import { spawnSync } from 'node:child_process';

const email = 'cypress.user@example.test';
const response = await fetch('http://127.0.0.1:5080/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, username: 'cypress-user', password: 'Cypress-pass-123!', firstName: 'Cypress', lastName: 'User' })
});
if (!response.ok && response.status !== 409) {
  console.error(`Auth seed registration failed: ${response.status} ${await response.text()}`);
  process.exit(1);
}
const sql = `
UPDATE asp_net_users
SET email = '${email}',
    normalized_email = 'CYPRESS.USER@EXAMPLE.TEST',
    email_confirmed = true
WHERE normalized_email IN ('CYPRESS.USER@EXAMPLE.TEST', 'CYPRESS.USER+CHANGED@EXAMPLE.TEST')
   OR user_name = 'cypress-user';

UPDATE user_profiles
SET location = NULL,
    birth_year = NULL,
    preferred_language = 'en',
    is_first_name_public = false,
    is_last_name_public = false,
    is_location_public = false,
    is_birth_year_public = false,
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
