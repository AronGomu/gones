/**
 * C27 scheduler runtime smoke.
 *
 * Simulates the reminder clock against a running stack: a reminder that comes due is delivered once
 * and recorded once, a reminder missed while the Worker was down is marked missed instead of sent
 * late, the tournament lifecycle advances on its own, and a Worker restart replays nothing.
 *
 * Set GONES_COMPOSE_FILE to run it against another Compose project — the release rehearsal points it
 * at the isolated release-test stack.
 */
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const composeArgs = process.env.GONES_COMPOSE_FILE ? ['compose', '-f', process.env.GONES_COMPOSE_FILE] : ['compose'];

function psql(sql, tuplesOnly = false) {
  const args = [...composeArgs, 'exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-v', 'ON_ERROR_STOP=1'];
  if (tuplesOnly) args.push('-At');
  const result = spawnSync('docker', args, { input: sql, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

const userId = randomUUID();
const profileId = randomUUID();
const organizationId = randomUUID();
const lifecycleTournamentId = randomUUID();
const reminderTournamentId = randomUUID();
const registrationId = randomUUID();
const dueId = randomUUID();
const missedId = randomUUID();
const suffix = randomUUID().replaceAll('-', '');
const email = `scheduler-${suffix}@example.test`;
const dueDedupe = `c27-runtime-due-${suffix}`;
const missedDedupe = `c27-runtime-missed-${suffix}`;

psql(`
INSERT INTO asp_net_users
  (id, global_role, user_name, normalized_user_name, email, normalized_email, email_confirmed,
   phone_number_confirmed, two_factor_enabled, lockout_enabled, access_failed_count, security_stamp, concurrency_stamp)
VALUES
  ('${userId}', 'User', '${email}', upper('${email}'), '${email}', upper('${email}'), true,
   false, false, false, 0, '${suffix}', '${suffix}');
INSERT INTO user_profiles
  (id, user_id, username, normalized_username, first_name, last_name, preferred_language,
   is_first_name_public, is_last_name_public, is_location_public, is_birth_date_public,
   is_preferred_language_public, created_at, updated_at, version)
VALUES
  ('${profileId}', '${userId}', 'Smoke${suffix.slice(0, 8)}', upper('Smoke${suffix.slice(0, 8)}'),
   'Runtime', 'Smoke', 'en', false, false, false, false, false, now(), now(), 1);
INSERT INTO organizations
  (id, name, normalized_name, created_at, updated_at, version)
VALUES
  ('${organizationId}', 'Scheduler Smoke ${suffix.slice(0, 8)}', upper('Scheduler Smoke ${suffix.slice(0, 8)}'), now(), now(), 1);
INSERT INTO events
  (id, organization_id, title, slug, street_address, city, country, time_zone_id,
   venue_start_date, venue_start_time, venue_end_date, venue_end_time, starts_at_utc, ends_at_utc,
   status, created_by_user_id, created_at, updated_at, normalized_search_text, version)
VALUES
  ('${lifecycleTournamentId}', '${organizationId}', 'Lifecycle Smoke', 'lifecycle-${suffix}', '1 Main Street', 'UTC', 'Test', 'Etc/UTC',
   current_date, localtime, current_date, localtime, now() + interval '4 seconds', now() + interval '9 seconds',
   'Published', '${userId}', now(), now(), 'LIFECYCLE SMOKE UTC TEST', 1),
  ('${reminderTournamentId}', '${organizationId}', 'Reminder Smoke', 'reminder-${suffix}', '1 Main Street', 'UTC', 'Test', 'Etc/UTC',
   current_date + 1, time '12:00', current_date + 1, time '13:00', now() + interval '1 day', now() + interval '25 hours',
   'Published', '${userId}', now(), now(), 'REMINDER SMOKE UTC TEST', 1);
INSERT INTO event_registration_attempts
  (id, event_id, user_id, status, registered_by_user_id, registered_at, version)
VALUES
  ('${registrationId}', '${reminderTournamentId}', '${userId}', 'Confirmed', '${userId}', now(), 1);
INSERT INTO scheduled_notifications
  (id, event_id, registration_attempt_id, user_id, type, scheduled_at_utc, dedupe_key, status, created_at, updated_at)
VALUES
  ('${dueId}', '${reminderTournamentId}', '${registrationId}', '${userId}', 'DayOne', now() + interval '2 seconds', '${dueDedupe}', 'Planned', now(), now()),
  ('${missedId}', '${reminderTournamentId}', '${registrationId}', '${userId}', 'DayTwo', now() - interval '2 minutes', '${missedDedupe}', 'Planned', now(), now());
`);

let state = '';
for (let attempt = 0; attempt < 90; attempt++) {
  state = psql(`
    SELECT
      (SELECT status FROM scheduled_notifications WHERE id = '${dueId}') || '|' ||
      (SELECT status FROM scheduled_notifications WHERE id = '${missedId}') || '|' ||
      (SELECT status FROM events WHERE id = '${lifecycleTournamentId}') || '|' ||
      (SELECT count(*) FROM notification_history WHERE dedupe_key = '${dueDedupe}');
  `, true);
  if (state === 'Enqueued|Missed|Completed|1') break;
  await new Promise(resolve => setTimeout(resolve, 1000));
}
if (state !== 'Enqueued|Missed|Completed|1') throw new Error(`Scheduler runtime smoke timed out; state=${state}`);

const restart = spawnSync('docker', [...composeArgs, 'restart', 'worker'], { encoding: 'utf8' });
if (restart.status !== 0) throw new Error(`${restart.stdout}\n${restart.stderr}`);
await new Promise(resolve => setTimeout(resolve, 3000));
const lateOutboxCount = psql(`SELECT count(*) FROM notification_outbox WHERE dedupe_key = '${missedDedupe}';`, true);
if (lateOutboxCount !== '0') throw new Error('Missed reminder sent after worker restart.');

console.log('C27 scheduler smoke passed: due delivery/history once, downtime missed without late send, lifecycle completed, restart safe.');
