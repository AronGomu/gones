import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const backend = join(root, 'backend');
const snapshot = join(backend, 'openapi', 'gones.json');
const generated = join(root, 'src', 'app', 'api', 'generated', 'gones-api.ts');
const check = process.argv.includes('--check');
const listenUrl = 'http://127.0.0.1:0';
const temp = mkdtempSync(join(tmpdir(), 'gones-api-'));
const tempSnapshot = join(temp, 'gones.json');
const tempGenerated = join(temp, 'gones-api.ts');
const restore = spawnSync('dotnet', ['tool', 'restore', '--tool-manifest', join(backend, '.config', 'dotnet-tools.json')], { cwd: root, encoding: 'utf8' });
if (restore.status !== 0) throw new Error(`${restore.stdout}\n${restore.stderr}`);

const api = spawn('dotnet', ['run', '--project', join(backend, 'src', 'Gones.Api', 'Gones.Api.csproj'), '--configuration', 'Release', '--no-launch-profile', '--urls', listenUrl], {
  cwd: root,
  env: {
    ...process.env,
    ASPNETCORE_ENVIRONMENT: 'Development',
    DOTNET_ENVIRONMENT: 'Development',
    GONES_DB_CONNECTION: process.env.GONES_DB_CONNECTION ?? 'Host=127.0.0.1;Port=5432;Database=gones;Username=gones;Password=gones',
    GONES_ALLOWED_ORIGINS: process.env.GONES_ALLOWED_ORIGINS ?? 'http://127.0.0.1:4200',
    'GONES_FEATURES__AUTH_V1': 'true',
    GONES_AUTH_PROVIDER: 'Local',
    GONES_AUTH_SIGNING_KEY: 'x'.repeat(32),
    GONES_PUBLIC_APP_ORIGIN: 'https://app.example'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
api.stdout.on('data', chunk => output += chunk);
api.stderr.on('data', chunk => output += chunk);

try {
  let document;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const boundUrl = output.match(/Now listening on:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (!boundUrl) throw new Error('API still starting.');
      const response = await fetch(`${boundUrl}/openapi/v1.json`);
      if (response.ok) {
        document = await response.json();
        break;
      }
    } catch { /* API still starting. */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
  }
  if (!document) throw new Error(`API OpenAPI endpoint did not start.\n${output}`);
  document.servers = [{ url: '' }];
  writeFileSync(tempSnapshot, `${JSON.stringify(document, null, 2)}\n`);

  const generation = spawnSync('dotnet', [
    'nswag', 'openapi2tsclient', `/input:${tempSnapshot}`, `/output:${tempGenerated}`,
    '/template:Angular', '/httpClass:HttpClient', '/injectionTokenType:InjectionToken',
    '/rxJsVersion:7.0', '/generateClientClasses:true', '/generateClientInterfaces:true',
    '/generateDtoTypes:true', '/typeStyle:Interface', '/dateTimeType:string', '/useSingletonProvider:true'
  ], { cwd: backend, encoding: 'utf8' });
  if (generation.status !== 0) throw new Error(`${generation.stdout}\n${generation.stderr}`);

  const files = [[snapshot, tempSnapshot], [generated, tempGenerated]];
  if (check) {
    const changed = files.filter(([committed, candidate]) => readFileSync(committed, 'utf8').replaceAll('\r\n', '\n') !== readFileSync(candidate, 'utf8').replaceAll('\r\n', '\n'));
    if (changed.length) throw new Error(`Generated API contract stale: ${changed.map(([path]) => path.replace(`${root}\\`, '')).join(', ')}. Run npm run api:generate.`);
  } else {
    for (const [destination, source] of files) writeFileSync(destination, readFileSync(source, 'utf8').replaceAll('\r\n', '\n'));
  }
} finally {
  api.kill();
  rmSync(temp, { recursive: true, force: true });
}
