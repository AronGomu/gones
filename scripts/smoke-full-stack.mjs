import { spawnSync } from 'node:child_process';

const profile = process.argv.includes('--release') ? 'release' : 'development';
const frontendUrl = profile === 'release' ? 'http://127.0.0.1:8081/health' : 'http://127.0.0.1:4200/';

async function waitFor(url, label) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* service still starting */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`${label} did not become healthy: ${url}`);
}

await waitFor(frontendUrl, 'frontend');
await waitFor('http://127.0.0.1:5080/health/live', 'API liveness');
await waitFor('http://127.0.0.1:5080/health/ready', 'API readiness');

const commands = [
  ['compose', 'ps', '--status', 'exited', 'migrator'],
  ['compose', 'logs', 'worker'],
  ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-Atc', "select \"MigrationId\" from \"__EFMigrationsHistory\" order by \"MigrationId\";"]
];
const outputs = commands.map(args => spawnSync('docker', args, { encoding: 'utf8' }));
for (const result of outputs) if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
if (!outputs[0].stdout.includes('migrator')) throw new Error('Migrator completion missing.');
if (!outputs[1].stdout.includes('Gones Worker heartbeat')) throw new Error('Worker heartbeat missing.');
const expectedMigrations = ['20260724111457_InitialPersistence', '20260724112436_AppendOnlyAuditGuard', '20260731205826_AddNotificationOutbox', '20260731220244_AddObservabilityState', '20260731224550_AddLocalIdentity', '20260801091711_AddRefreshSessions', '20260801105351_AddAccountLifecycle', '20260801114004_AddExternalOAuth', '20260801152724_AddAdminBootstrapAndFormats', '20260801154546_AddOrganizations', '20260801162721_AddUserProfileClosedAt', '20260802093814_AddScheduledTournaments', '20260802120000_MakeScheduledTournamentSlugGlobal'];
const actualMigrations = outputs[2].stdout.trim().split(/\r?\n/).filter(Boolean);
if (JSON.stringify(actualMigrations) !== JSON.stringify(expectedMigrations)) {
  throw new Error(`PostgreSQL migrations differ. Expected ${expectedMigrations.join(', ')}; got ${actualMigrations.join(', ')}`);
}
console.log(`Full-stack ${profile} smoke passed.`);
