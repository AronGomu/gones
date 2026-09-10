import { spawn, spawnSync } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { once } from 'node:events';
import cypress from 'cypress';

const root = resolve(import.meta.dirname, '..');
const built = resolve(root, 'dist/gones/browser');
if (!existsSync(resolve(built, 'index.html'))) throw new Error('Run npm run build before the isolated owner setup smoke.');
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GONES_')));
const name = `gones-owner-smoke-${process.pid}-${Date.now()}`;
let databaseStarted = false;
let api;
let apiOrigin;
let apiOutput = '';
const run = (command, args, env = environment) => {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 120_000 });
  if (result.status !== 0) throw new Error(`${command} failed in isolated owner setup fixture.`);
  return result.stdout;
};
const sql = statement => run('docker', ['exec', name, 'psql', '-U', 's6_fixture', '-d', 's6_fixture', '-At', '-c', statement]).trim();
let cliEnvironment;
const cli = (...args) => run('dotnet', ['backend/src/Gones.Migrator/bin/Debug/net10.0/Gones.Migrator.dll', ...args], cliEnvironment);
const contentTypes = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.html': 'text/html' };
const web = createServer((req, res) => {
  const path = new URL(req.url, 'http://fixture.invalid').pathname;
  if (path.startsWith('/api/') || path.startsWith('/health/')) {
    if (!apiOrigin) { res.writeHead(503).end(); return; }
    const upstream = httpRequest(new URL(req.url, apiOrigin), { method: req.method, headers: { ...req.headers, host: new URL(apiOrigin).host } }, reply => {
      res.writeHead(reply.statusCode, reply.headers);
      reply.pipe(res);
    });
    upstream.on('error', () => res.writeHead(502).end());
    req.pipe(upstream);
    return;
  }
  if (path === '/runtime-config.json') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ dataMode: 'server', apiBaseUrl: `http://127.0.0.1:${web.address().port}`, features: { authV1: true, adminV1: true } }));
    return;
  }
  const candidate = resolve(built, '.' + path);
  if (!candidate.startsWith(built + '/')) { res.writeHead(404).end(); return; }
  const file = existsSync(candidate) && extname(candidate) ? candidate : resolve(built, 'index.html');
  res.setHeader('Content-Type', contentTypes[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
});

try {
  run('docker', ['run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_USER=s6_fixture', '-e', 'POSTGRES_PASSWORD=s6-fixture-only', '-e', 'POSTGRES_DB=s6_fixture', '-p', '127.0.0.1::5432', 'postgres:17-alpine']);
  databaseStarted = true;
  const port = run('docker', ['port', name, '5432/tcp']).trim().split(':').at(-1);
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (spawnSync('docker', ['exec', name, 'pg_isready', '-U', 's6_fixture'], { cwd: root, stdio: 'ignore' }).status === 0) { ready = true; break; }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
  }
  if (!ready) throw new Error('Isolated owner setup PostgreSQL did not start.');
  web.listen(0, '127.0.0.1');
  await once(web, 'listening');
  const origin = `http://127.0.0.1:${web.address().port}`;
  cliEnvironment = {
    ...environment,
    DOTNET_ENVIRONMENT: 'Testing', ASPNETCORE_ENVIRONMENT: 'Testing',
    GONES_DB_CONNECTION: `Host=127.0.0.1;Port=${port};Database=s6_fixture;Username=s6_fixture;Password=s6-fixture-only`,
    GONES_BOOTSTRAP_ADMIN_EMAIL: 'owner@example.test', GONES_DEPLOYMENT_ENVIRONMENT: 'testing',
    GONES_PUBLIC_APP_ORIGIN: 'https://owner-fixture.example', GONES_ALLOWED_ORIGINS: origin,
    GONES_FEATURES__AUTH_V1: 'true', GONES_FEATURES__ADMIN_V1: 'true', GONES_AUTH_PROVIDER: 'Local',
    GONES_AUTH_SIGNING_KEY: 's6-fixture-signing-key-at-least-32-characters',
    Gones__Auth__RefreshCookie__Secure: 'false'
  };
  cli('database', 'update');
  cli('owner', 'setup');
  if (sql('SELECT count(*) FROM asp_net_users') !== '0') throw new Error('Owner setup must not create an account before confirmation.');
  api = spawn('dotnet', ['backend/src/Gones.Api/bin/Debug/net10.0/Gones.Api.dll', '--urls', 'http://127.0.0.1:0'], { cwd: root, env: cliEnvironment, stdio: ['ignore', 'pipe', 'pipe'] });
  api.stdout.on('data', chunk => { apiOutput += chunk; });
  api.stderr.on('data', chunk => { apiOutput += chunk; });
  for (let attempt = 0; attempt < 120; attempt++) {
    apiOrigin = apiOutput.match(/Now listening on:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    if (apiOrigin) break;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
  }
  if (!apiOrigin) throw new Error('Isolated owner setup API did not start.');
  process.env.S6_OWNER_SMOKE_CONTAINER = name;
  const result = await cypress.run({
    project: root, configFile: 'cypress/owner-setup.config.mjs',
    config: { e2e: { baseUrl: origin } }
  });
  if (result.status === 'failed' || result.totalFailed || result.totalPassed !== 1) throw new Error('Owner setup browser acceptance failed.');
  if (apiOutput.includes('owner-browser-chosen-password')) throw new Error('Owner password leaked to API logs.');
  console.log('Owner setup browser acceptance passed: fresh DB, explicit password, private promotion, normal login, Admin reload.');
} finally {
  delete process.env.S6_OWNER_SMOKE_CONTAINER;
  if (api && api.exitCode === null) { api.kill(); await once(api, 'exit'); }
  web.closeAllConnections();
  if (web.listening) await new Promise(done => web.close(done));
  if (databaseStarted) run('docker', ['rm', '-f', name]);
}
