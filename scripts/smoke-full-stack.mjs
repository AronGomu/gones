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

// The paged list is retired (ADR 0042); the summary catalog is the archive's list surface. The fixed
// placeholder League this used to assert on is retired too (T19), so the check is that the catalog
// answers at all and answers cacheably — there is no seeded row left to name.
const leagueListResponse = await fetch('http://127.0.0.1:5080/api/archive/leagues/all');
if (!leagueListResponse.ok) throw new Error(`Archive League catalog failed: ${leagueListResponse.status}`);
const leagueList = await leagueListResponse.json();
if (!Array.isArray(leagueList.items)) throw new Error('Archive League catalog has no items array.');
if (!leagueListResponse.headers.get('etag')) throw new Error('Archive League catalog ETag missing.');

// The retired surface answers 404 with no alias and no redirect (ADR 0022's "no API path aliases").
const retiredResponse = await fetch('http://127.0.0.1:5080/api/leagues-archive/all');
if (retiredResponse.status !== 404) throw new Error(`Retired League catalog answered ${retiredResponse.status}, expected 404.`);

const liveListResponse = await fetch('http://127.0.0.1:5080/api/live-tournaments?pageSize=100');
if (!liveListResponse.ok) throw new Error(`Live Tournament list failed: ${liveListResponse.status}`);
const liveList = await liveListResponse.json();
if (!Array.isArray(liveList.items)) throw new Error('Live Tournament list shape differs.');
if (!liveListResponse.headers.get('etag')) throw new Error('Live Tournament list ETag missing.');
for (const item of liveList.items.filter(entry => entry.id === 'local-live-demo')) {
  const liveDetailResponse = await fetch(`http://127.0.0.1:5080/api/live-tournaments/${item.id}`);
  if (!liveDetailResponse.ok) throw new Error(`Seeded Live Tournament detail failed: ${liveDetailResponse.status}`);
  const liveDetail = await liveDetailResponse.json();
  if (liveDetail.id !== 'local-live-demo' || liveDetail.stage !== 'standings') throw new Error('Seeded Live Tournament detail differs.');
  if ('pairingSeed' in liveDetail || 'checkpoints' in liveDetail) throw new Error('Live Tournament public detail leaks mutation details.');
  if (!liveDetailResponse.headers.get('etag')) throw new Error('Seeded Live Tournament detail ETag missing.');
}

const commands = [
  ['compose', 'ps', '--status', 'exited', 'migrator'],
  ['compose', 'logs', 'worker'],
  ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-Atc', "select \"MigrationId\" from \"__EFMigrationsHistory\" order by \"MigrationId\";"]
];
const outputs = commands.map(args => spawnSync('docker', args, { encoding: 'utf8' }));
for (const result of outputs) if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
if (!outputs[0].stdout.includes('migrator')) throw new Error('Migrator completion missing.');
if (!outputs[1].stdout.includes('Gones Worker heartbeat')) throw new Error('Worker heartbeat missing.');
const expectedMigrations = [
  '20260822145459_InitialCreate',
  '20260822183905_RebuildArchiveThreeTier',
  '20260822220652_ScopePlayerStatistics',
  '20260825185219_RetireLegacyLeagueArchive',
  '20260825213300_TrackSeasonCountsRevision',
  '20260831121550_AddEventRegionAndType',
  '20260831183735_AddTemporaryEventImages',
  '20260831190301_RestrictEventImageOwnerDeletes',
  '20260901174816_UseEventMarkdown',
  '20260902070415_DirectEventPublication',
  '20260903090430_RemoveEventProviderGeodata'
];
const actualMigrations = outputs[2].stdout.trim().split(/\r?\n/).filter(Boolean);
if (JSON.stringify(actualMigrations) !== JSON.stringify(expectedMigrations)) {
  throw new Error(`PostgreSQL migrations differ. Expected ${expectedMigrations.join(', ')}; got ${actualMigrations.join(', ')}`);
}
console.log(`Full-stack ${profile} smoke passed.`);
