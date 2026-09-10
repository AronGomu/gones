// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const cleanEnv = { PATH: process.env['PATH'], HOME: process.env['HOME'] };
const names = ['api', 'backup', 'frontend', 'migrator', 'otel-collector', 'permissions', 'worker'];
interface Service {
  image: string;
  user: string;
  environment: Record<string, string>;
  secrets?: { source: string; target: string }[];
  volumes?: { type: string; source: string; target: string; read_only?: boolean; bind?: { create_host_path?: boolean } }[];
  networks: Record<string, { ipv4_address?: string }>;
  depends_on?: Record<string, { condition: string }>;
  deploy?: { replicas: number };
  ports?: string[];
  build?: unknown;
  entrypoint?: unknown;
  command?: unknown;
  healthcheck?: unknown;
  use_api_socket?: boolean;
  post_start?: unknown;
  pre_stop?: unknown;
  read_only: boolean;
  cpus: number;
  mem_limit: string | number;
  memswap_limit: string | number;
  pids_limit: number;
  tmpfs: string[];
  cap_drop: string[];
  security_opt: string[];
  logging: { driver: string; options: Record<string, string> };
}
interface Compose {
  name: string;
  services: Record<string, Service>;
  secrets: Record<string, { file: string; external?: boolean }>;
  networks: Record<string, { name: string; external?: boolean }>;
}
function render(environment: string, overrides: Record<string, string> = {}): Compose {
  const result = spawnSync('docker', ['compose', '--env-file', 'deploy/shared-host/config.fixture.env', '-p', `gones-${environment}`,
    '-f', `compose.${environment}.yaml`, '--profile', 'tools', 'config', '--format', 'json'], {
    cwd: root, encoding: 'utf8', env: { ...cleanEnv, ...overrides }
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Compose;
}

// Defining invariants: immutable/scoped artifacts; least-privilege mounts; no app authority over edge/prod.
describe.each(['staging', 'prod'])('shared-host %s contract', (environment) => {
  it('requires immutable runtime images, no local providers, no build', () => {
    const config = render(environment);
    expect(config.name).toBe(`gones-${environment}`);
    expect(Object.keys(config.services).sort()).toEqual(names);
    for (const service of Object.values(config.services)) {
      expect(service.image).toMatch(/^[^\s@]+@sha256:[a-f0-9]{64}$/);
      expect(service.build).toBeUndefined();
      expect(JSON.stringify(service.environment ?? {})).not.toMatch(/ALLOW_TEST|FAULT_INJECTION|Fake|localhost|local-.*only/);
    }
    expect(config.services['permissions'].image).toBe(config.services['backup'].image);
  });

  it('mounts only each service secret inventory, never a secret directory', () => {
    const config = render(environment);
    const inventories: Record<string, string[]> = {
      api: ['db-app', 'auth-signing', 'object-access', 'object-secret', 'google-secret', 'facebook-secret', 'webhook-token', 'worker-wake-token'],
      worker: ['db-app', 'auth-signing', 'object-access', 'object-secret', 'brevo-key', 'worker-wake-token'],
      migrator: ['db-migration'], permissions: ['db-permissions-service'],
      backup: ['db-backup', 'backup-key'], 'otel-collector': ['otel-auth'], frontend: []
    };
    if (environment === 'staging') {
      for (const name of ['api', 'worker']) inventories[name].push('staging-policy', 'bootstrap-admin-email');
    }
    for (const [name, service] of Object.entries(config.services)) {
      expect((service.secrets ?? []).map((secret) => secret.source).sort()).toEqual(inventories[name].sort());
      for (const secret of service.secrets ?? []) {
        expect(secret.target).toBe(`/run/secrets/gones-${environment}/${secret.source}`);
        expect(config.secrets[secret.source].file).toBe(`/etc/gones/${environment}/secrets/${secret.source}`);
      }
      for (const [key, value] of Object.entries(service.environment ?? {})) {
        if (!key.endsWith('_FILE') && key !== 'PGSERVICEFILE') continue;
        expect(service.secrets?.some((secret) => secret.target === value), `${name}.${key}`).toBe(true);
        expect(service.environment[key.replace(/_FILE$/, '')]).toBe(key === 'PGSERVICEFILE' ? value : undefined);
      }
      for (const volume of service.volumes ?? []) {
        expect(volume.type).toBe('bind');
        expect(volume.bind?.create_host_path).toBe(false);
        expect(volume.source).not.toMatch(/docker\.sock|\/secrets\/?$/);
        expect(volume.read_only ?? false).toBe(!['backup', 'worker'].includes(name));
      }
    }
    expect(config.services['backup'].user).toBe('65532:65532');
    for (const name of ['api', 'worker', 'migrator']) expect(config.services[name].user).toBe('1654:1654');
    expect(config.services['frontend'].user).toBe('101:101');
  });

  it('fixes staging activation and private policy identity without production leakage or shell switches', () => {
    const config = render(environment, {
      GONES_DEPLOYMENT_ENVIRONMENT: 'local', GONES_STAGING_POLICY_FILE: '/tmp/SENTINEL_DO_NOT_ECHO',
      GONES_BOOTSTRAP_ADMIN_EMAIL: 'SENTINEL_DO_NOT_ECHO', GONES_WORKER_IDLE_MODE: 'true',
      GONES_WORKER_WAKE_SOCKET: '/tmp/SENTINEL_DO_NOT_ECHO', GONES_WORKER_WAKE_TOKEN_FILE: '/tmp/SENTINEL_DO_NOT_ECHO'
    });
    for (const name of ['api', 'worker']) {
      const service = config.services[name];
      const env = service.environment;
      expect(env['GONES_DEPLOYMENT_ENVIRONMENT']).toBe(environment === 'staging' ? 'staging' : 'production');
      expect(env[name === 'api' ? 'ASPNETCORE_ENVIRONMENT' : 'DOTNET_ENVIRONMENT']).toBe('Production');
      expect(env['GONES_STAGING_POLICY_FILE']).toBe(environment === 'staging' ? '/run/secrets/gones-staging/staging-policy' : undefined);
      expect(env['GONES_BOOTSTRAP_ADMIN_EMAIL_FILE']).toBe(environment === 'staging' ? '/run/secrets/gones-staging/bootstrap-admin-email' : undefined);
      expect(env['GONES_BOOTSTRAP_ADMIN_EMAIL']).toBeUndefined();
      expect(env['GONES_WORKER_IDLE_MODE']).toBe('false');
      expect(env['GONES_WORKER_WAKE_SOCKET']).toBe(`/run/gones-worker-${environment}/wake.sock`);
      expect(env['GONES_WORKER_WAKE_TOKEN_FILE']).toBe(`/run/secrets/gones-${environment}/worker-wake-token`);
      expect(service.command ?? null).toBeNull();
      expect(service.entrypoint ?? null).toBeNull();
      expect(service.healthcheck).toBeUndefined();
    }
    expect(JSON.stringify(config)).not.toContain('SENTINEL_DO_NOT_ECHO');
    if (environment === 'prod') expect(JSON.stringify(config)).not.toMatch(/GONES_STAGING|gones-staging|\/gones\/staging\/|bootstrap-admin-email|noindex/i);
    for (const name of names.filter((name) => !['api', 'worker'].includes(name))) {
      expect(JSON.stringify(config.services[name])).not.toMatch(/GONES_(?:STAGING|BOOTSTRAP_ADMIN|WORKER|DEPLOYMENT_ENVIRONMENT)/);
    }
  });

  it('shares only private wake directory API RO/Worker RW with separate immutable token and idle health off', () => {
    const config = render(environment);
    for (const name of ['api', 'worker']) {
      const service = config.services[name];
      expect(service.volumes).toEqual([{
        type: 'bind', source: `/var/lib/gones/${environment}/worker-wake`, target: `/run/gones-worker-${environment}`,
        ...(name === 'api' ? { read_only: true } : {}), bind: { create_host_path: false }
      }]);
      expect(service.user).toBe('1654:1654');
      expect(service.environment['GONES_WORKER_HEALTH_PATH']).toBeUndefined();
      expect(service.secrets).toContainEqual({ source: 'worker-wake-token', target: `/run/secrets/gones-${environment}/worker-wake-token` });
    }
    for (const name of names.filter((name) => !['api', 'worker'].includes(name))) {
      expect(JSON.stringify(config.services[name])).not.toMatch(/worker-wake|staging-policy|bootstrap-admin-email/);
    }
  });

  it('has no published ports, edge service, host namespace, cross-environment attachments', () => {
    const config = render(environment);
    expect(config.networks['edge']).toMatchObject({ name: `gones-${environment}-edge`, external: true });
    expect(config.networks['core'].name).toBe(`gones-${environment}-core`);
    for (const [name, service] of Object.entries(config.services)) {
      expect(service.ports).toBeUndefined();
      expect(Object.keys(service.networks).sort()).toEqual(name === 'api' ? ['core', 'edge'] : name === 'frontend' ? ['edge'] : ['core']);
      expect(JSON.stringify(service)).not.toMatch(/docker\.sock|network_mode|pid_mode|privileged|\/etc\/gones\/edge/);
    }
    expect(config.services['api'].environment['GONES_FORWARDED_PROXIES']).toBe(environment === 'staging' ? '172.30.10.2' : '172.30.20.2');
    expect(config.services['api'].environment['GONES_FORWARDED_PROXY_HOP_LIMIT']).toBe('1');
  });

  it('bounds every service, including profiled backup; preserves migration/grants ordering', () => {
    const config = render(environment);
    for (const service of Object.values(config.services)) {
      expect(service.read_only).toBe(true);
      expect(Number(service.cpus)).toBeGreaterThan(0);
      expect(Number(service.cpus)).toBeLessThanOrEqual(1);
      expect(Number(service.mem_limit)).toBeGreaterThan(0);
      expect(Number(service.mem_limit)).toBeLessThanOrEqual(512 * 1024 * 1024);
      expect(service.memswap_limit).toBe(service.mem_limit);
      expect(service.pids_limit).toBeGreaterThan(0);
      expect(service.pids_limit).toBeLessThanOrEqual(256);
      expect(service.cap_drop).toEqual(['ALL']);
      expect(service.security_opt).toEqual(['no-new-privileges:true']);
      expect(service.tmpfs.length).toBeGreaterThan(0);
      for (const tmpfs of service.tmpfs) expect(tmpfs).toMatch(/size=\d+m/);
      expect(service.logging).toEqual({ driver: 'json-file', options: { 'max-size': '5m', 'max-file': '2' } });
    }
    const ceilings: Record<string, [number, number]> = {
      api: [0.5, 512], worker: [0.35, 384], frontend: [0.1, 64],
      'otel-collector': [0.15, 192], migrator: [0.5, 384], permissions: [0.25, 128], backup: [0.5, 384]
    };
    for (const [name, [cpu, memory]] of Object.entries(ceilings)) {
      expect(Number(config.services[name].cpus)).toBe(cpu);
      expect(Number(config.services[name].mem_limit)).toBe(memory * 1024 * 1024);
      expect(Number(config.services[name].pids_limit)).toBe(128);
    }
    const steady = ['api', 'worker', 'frontend', 'otel-collector'];
    expect(steady.reduce((sum, name) => sum + Number(config.services[name].mem_limit), 0)).toBe(1152 * 1024 * 1024);
    expect(config.services['worker'].deploy?.replicas).toBe(1);
    expect(config.services['permissions'].depends_on?.['migrator'].condition).toBe('service_completed_successfully');
    for (const name of ['api', 'worker']) expect(config.services[name].depends_on?.['permissions'].condition).toBe('service_completed_successfully');
    expect(config.services['frontend'].depends_on?.['api'].condition).toBe('service_healthy');
  });

  it('keeps exact same-origin runtime config; uses EU R2 plus external Collector prerequisites', () => {
    const config = render(environment);
    const origin = `https://${environment}.example.invalid`;
    for (const name of ['api', 'worker']) {
      const env = config.services[name].environment;
      expect(env['GONES_ALLOWED_ORIGINS']).toBe(origin);
      expect(env['GONES_PUBLIC_APP_ORIGIN']).toBe(origin);
      expect(env['GONES_EVENT_IMAGES_S3_REGION']).toBe('auto');
      expect(env['GONES_EVENT_IMAGES_S3_ENDPOINT']).toMatch(/^https:\/\/[a-z0-9]+\.eu\.r2\.cloudflarestorage\.com$/);
      expect(env['OTEL_EXPORTER_OTLP_ENDPOINT']).toBe('http://otel-collector:4317');
    }
    expect(config.services['api'].environment['GONES_OAUTH_CALLBACK_ORIGIN']).toBe(origin);
    expect(config.services['frontend'].environment['GONES_API_BASE_URL']).toBe(origin);
    expect(config.services['frontend'].environment['GONES_DATA_MODE']).toBe('server');
    expect(config.services['otel-collector'].volumes?.[0].source).toBe(`/etc/gones/${environment}/telemetry/collector.yaml`);
  });
});

describe('shared-host fail-closed checks', () => {
  it('rejects absent required config in Compose itself', () => {
    const result = spawnSync('docker', ['compose', '--env-file', '/dev/null', '-p', 'gones-staging', '-f', 'compose.staging.yaml', 'config', '--quiet'], {
      cwd: root, encoding: 'utf8', env: cleanEnv
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('required variable');
  });

  it('executes config-only CLI against harmless fixtures', () => {
    const result = spawnSync('node', ['scripts/shared-host-config.mjs', '--fixture'], { cwd: root, encoding: 'utf8', env: cleanEnv });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('static contract passed; deployment gates remain unverified');
  });

  it('rejects policy regressions in parsed Compose, without logging substituted values', async () => {
    // @ts-expect-error - config validator is a plain ESM script shared with the CLI.
    const { validateSharedHost } = await import('../scripts/shared-host-config.mjs');
    const staging = render('staging');
    const prod = render('prod');
    expect(validateSharedHost(staging, prod)).toEqual([]);
    const mutations: [string, (config: Compose) => void][] = [
      ['api immutable preloaded image', (c) => { c.services['api'].image = 'registry.invalid/api:latest'; }],
      ['same-origin runtime', (c) => { c.services['api'].environment['GONES_ALLOWED_ORIGINS'] = 'http://insecure.invalid'; }],
      ['exact HTTPS DNS origin', (c) => { c.services['api'].environment['GONES_PUBLIC_APP_ORIGIN'] = 'https://staging.example.invalid/path'; }],
      ['exact HTTPS DNS origin', (c) => { c.services['api'].environment['GONES_PUBLIC_APP_ORIGIN'] = 'https://a.x-'; }],
      ['api direct secret forbidden', (c) => { c.services['api'].environment['GONES_AUTH_SIGNING_KEY'] = 'SENTINEL_DO_NOT_ECHO'; }],
      ['api secret scope', (c) => { c.services['api'].secrets = []; }],
      ['environment secret source', (c) => { c.secrets['db-app'].file = '/etc/gones/prod/secrets/db-app'; }],
      ['api forbidden authority field', (c) => { c.services['api'].ports = ['8080:8080']; }],
      ['api network attachments', (c) => { c.services['api'].networks['prod'] = {}; }],
      ['singleton Worker', (c) => { c.services['worker'].deploy = { replicas: 2 }; }],
      ['api resource bounds', (c) => { c.services['api'].mem_limit = 0; }],
      ['otel-collector resource bounds', (c) => { c.services['otel-collector'].mem_limit = c.services['otel-collector'].memswap_limit = 256 * 1024 * 1024; }],
      ['frontend resource bounds', (c) => { c.services['frontend'].cpus = 0.2; }],
      ['worker resource bounds', (c) => { c.services['worker'].pids_limit = 256; }],
      ['exact edge trust', (c) => { c.services['api'].environment['GONES_FORWARDED_PROXIES'] = '0.0.0.0/0'; }],
      ['live provider modes', (c) => { c.services['api'].environment['GONES_AUTH_PROVIDER'] = 'Fake'; }],
      ['app object config parity', (c) => { c.services['worker'].environment['GONES_EVENT_IMAGES_S3_BUCKET'] = prod.services['worker'].environment['GONES_EVENT_IMAGES_S3_BUCKET']; }],
      ['migration before grants', (c) => { c.services['permissions'].depends_on = {}; }]
    ];
    for (const [rule, mutate] of mutations) {
      const changed = JSON.parse(JSON.stringify(staging)) as Compose;
      mutate(changed);
      const findings = validateSharedHost(changed, prod);
      expect(findings).toContain(`staging: ${rule}`);
      expect(JSON.stringify(findings)).not.toContain('SENTINEL_DO_NOT_ECHO');
    }
  });
});

describe.each(['staging', 'prod'])('shared-host %s runtime rejection contract', (environment) => {
  it.each(names.flatMap((name) => (['use_api_socket', 'post_start', 'pre_stop'] as const).map((key) => [name, key] as const)))(
    'rejects %s alternate authority %s without echoing hook data', async (name, key) => {
      // @ts-expect-error - config validator is a plain ESM script shared with the CLI.
      const { validateSharedHost } = await import('../scripts/shared-host-config.mjs');
      const staging = render('staging');
      const prod = render('prod');
      expect(validateSharedHost(staging, prod)).toEqual([]);
      const changed = structuredClone(environment === 'staging' ? staging : prod);
      if (key === 'use_api_socket') changed.services[name][key] = true;
      else changed.services[name][key] = [{
        command: ['echo', 'SENTINEL_DO_NOT_ECHO'], user: '0:0', privileged: true,
        environment: { GONES_WORKER_WAKE_TOKEN: 'SENTINEL_DO_NOT_ECHO' }
      }];
      const findings = environment === 'staging' ? validateSharedHost(changed, prod) : validateSharedHost(staging, changed);
      expect(findings).toEqual([`${environment}: ${name} forbidden authority field`]);
      expect(JSON.stringify(findings)).not.toContain('SENTINEL_DO_NOT_ECHO');
    }
  );

  it('rejects each policy, private wake, health or startup bypass with fixed diagnostics', async () => {
    // @ts-expect-error - config validator is a plain ESM script shared with the CLI.
    const { validateSharedHost } = await import('../scripts/shared-host-config.mjs');
    const staging = render('staging');
    const prod = render('prod');
    expect(validateSharedHost(staging, prod)).toEqual([]);
    const other = environment === 'staging' ? 'prod' : 'staging';
    const mutations: [string, (config: Compose) => void][] = [
      ['api runtime environment', (c) => { delete c.services['api'].environment['GONES_DEPLOYMENT_ENVIRONMENT']; }],
      ['worker runtime environment', (c) => { c.services['worker'].environment['GONES_DEPLOYMENT_ENVIRONMENT'] = 'local'; }],
      ['api runtime environment', (c) => { c.services['api'].environment['gones_deployment_environment'] = 'local'; }],
      ['api runtime environment', (c) => { c.services['api'].environment['ASPNETCORE_ENVIRONMENT'] = 'Staging'; }],
      ['worker runtime environment', (c) => { c.services['worker'].environment['DOTNET_ENVIRONMENT'] = 'Development'; }],
      ['api runtime environment', (c) => { c.services['api'].environment['DOTNET_ENVIRONMENT'] = 'Staging'; }],
      ['api direct secret forbidden', (c) => { c.services['api'].environment['GONES_BOOTSTRAP_ADMIN_EMAIL'] = 'SENTINEL_DO_NOT_ECHO'; }],
      ['worker direct secret forbidden', (c) => { c.services['worker'].environment['GONES_WORKER_WAKE_TOKEN'] = 'SENTINEL_DO_NOT_ECHO'; }],
      ['api runtime environment', (c) => { c.services['api'].environment['gones_worker_wake_token'] = 'SENTINEL_DO_NOT_ECHO'; }],
      ['api runtime environment', (c) => { delete c.services['api'].environment['GONES_WORKER_WAKE_SOCKET']; }],
      ['worker runtime environment', (c) => { c.services['worker'].environment['GONES_WORKER_WAKE_SOCKET'] = `/run/gones-worker-${other}/wake.sock`; }],
      ['api required secret file', (c) => { delete c.services['api'].environment['GONES_WORKER_WAKE_TOKEN_FILE']; }],
      ['worker required secret file', (c) => { c.services['worker'].environment['GONES_WORKER_WAKE_TOKEN_FILE'] = `/run/gones-worker-${environment}/wake.sock`; }],
      ['api runtime environment', (c) => { delete c.services['api'].environment['GONES_WORKER_IDLE_MODE']; }],
      ['worker runtime environment', (c) => { c.services['worker'].environment['GONES_WORKER_IDLE_MODE'] = 'true'; }],
      ['api runtime environment', (c) => { c.services['api'].environment['GONES_WORKER_IDLE_MODE'] = 'FALSE'; }],
      ['api runtime environment', (c) => { c.services['api'].environment['GONES_WORKER_HEALTH_PATH'] = `/run/gones-worker-${environment}/health.json`; }],
      ['worker runtime environment', (c) => { c.services['worker'].environment['GONES_WORKER_HEALTH_PATH'] = `/run/gones-worker-${environment}/wake.sock`; }],
      ['api runtime environment', (c) => { c.services['api'].environment['GONES_WORKER_HEALTH_PATH'] = `/run/gones-worker-${environment}/wake.sock.lock`; }],
      ['worker runtime environment', (c) => { c.services['worker'].environment['GONES_WORKER_HEALTH_PATH'] = `/run/secrets/gones-${environment}/worker-wake-token`; }],
      ['api fixed scoped bind', (c) => { c.services['api'].volumes![0].read_only = false; }],
      ['worker fixed scoped bind', (c) => { c.services['worker'].volumes![0].read_only = true; }],
      ['api fixed scoped bind', (c) => { c.services['api'].volumes![0].source = `/var/lib/gones/${other}/worker-wake`; }],
      ['worker fixed scoped bind', (c) => { c.services['worker'].volumes![0].target = `/run/secrets/gones-${environment}`; }],
      ['worker fixed scoped bind', (c) => { c.services['worker'].volumes![0].bind!.create_host_path = true; }],
      ['api volume inventory', (c) => { c.services['api'].volumes = []; }],
      ['worker platform/UID', (c) => { c.services['worker'].user = '0:0'; }],
      ['environment secret source', (c) => { c.secrets['worker-wake-token'].file = `/etc/gones/${other}/secrets/worker-wake-token`; }],
      ['environment secret source', (c) => { c.secrets['worker-wake-token'].external = true; }],
      ['api secret target', (c) => { c.services['api'].secrets!.find((s) => s.source === 'worker-wake-token')!.target = `/run/secrets/gones-${other}/worker-wake-token`; }],
      ['frontend secret scope', (c) => { c.services['frontend'].secrets = [{ source: 'worker-wake-token', target: `/run/secrets/gones-${environment}/worker-wake-token` }]; }],
      ['otel-collector volume inventory', (c) => { c.services['otel-collector'].volumes!.push(c.services['worker'].volumes![0]); }],
      ['frontend runtime environment', (c) => { c.services['frontend'].environment['GONES_WORKER_WAKE_SOCKET'] = `/run/gones-worker-${environment}/wake.sock`; }],
      ['worker inherited startup and health', (c) => { c.services['worker'].command = ['--wake']; }],
      ['api inherited startup and health', (c) => { c.services['api'].command = ['--GONES_DEPLOYMENT_ENVIRONMENT=production']; }],
      ['api inherited startup and health', (c) => { c.services['api'].entrypoint = ['sh']; }],
      ['worker inherited startup and health', (c) => { c.services['worker'].healthcheck = { test: ['CMD', 'dotnet', 'Gones.Worker.dll', '--health'] }; }],
      ['api inherited startup and health', (c) => { c.services['api'].healthcheck = { test: ['CMD', 'curl', 'http://localhost:8080/health/ready'] }; }]
    ];
    if (environment === 'staging') mutations.push(
      ['api required secret file', (c) => { delete c.services['api'].environment['GONES_STAGING_POLICY_FILE']; }],
      ['worker required secret file', (c) => { delete c.services['worker'].environment['GONES_BOOTSTRAP_ADMIN_EMAIL_FILE']; }],
      ['worker required secret file', (c) => { c.services['worker'].environment['GONES_STAGING_POLICY_FILE'] = '/tmp/other-policy'; }],
      ['environment secret source', (c) => { c.secrets['staging-policy'].file = '/etc/gones/prod/secrets/staging-policy'; }],
      ['api secret scope', (c) => { c.services['api'].secrets = c.services['api'].secrets!.filter((s) => s.source !== 'staging-policy'); }],
      ['frontend secret scope', (c) => { c.services['frontend'].secrets = [{ source: 'bootstrap-admin-email', target: '/run/secrets/gones-staging/bootstrap-admin-email' }]; }]
    );
    else mutations.push(
      ['api runtime environment', (c) => { c.services['api'].environment['GONES_STAGING_POLICY_FILE'] = '/run/secrets/gones-staging/staging-policy'; }],
      ['worker runtime environment', (c) => { c.services['worker'].environment['GONES_BOOTSTRAP_ADMIN_EMAIL_FILE'] = '/run/secrets/gones-staging/bootstrap-admin-email'; }],
      ['secret inventory', (c) => { c.secrets['staging-policy'] = { file: '/etc/gones/staging/secrets/staging-policy' }; }]
    );
    for (const [rule, mutate] of mutations) {
      const changed = structuredClone(environment === 'staging' ? staging : prod);
      mutate(changed);
      const findings = environment === 'staging' ? validateSharedHost(changed, prod) : validateSharedHost(staging, changed);
      expect(findings, rule).toContain(`${environment}: ${rule}`);
      expect(JSON.stringify(findings)).not.toMatch(/SENTINEL_DO_NOT_ECHO|\/run\/|\/etc\/|\/tmp\//);
    }
  });
});

describe('host-owned assets', () => {
  it('preserves audit grants, separate SELECT-only backup role, no passwords or role bootstrap', () => {
    const sql = read('deploy/shared-host/grants.sql');
    expect(sql).toContain('GRANT CONNECT ON DATABASE');
    expect(sql).toContain('GRANT USAGE ON SCHEMA public TO gones_app, gones_backup');
    expect(sql).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON audit_records FROM gones_app');
    expect(sql).toContain('GRANT UPDATE (actor_id) ON audit_records TO gones_app');
    expect(sql).toContain('GRANT SELECT ON ALL TABLES IN SCHEMA public TO gones_backup');
    expect(sql).not.toMatch(/PASSWORD|CREATE ROLE|GRANT .*UPDATE.*TO gones_backup/);
  });

  it('keeps noindex/robots staging-only; blocks inherited secret logs/compression; accommodates image uploads', () => {
    const stage = read('deploy/shared-host/edge.staging.conf.template');
    const prod = read('deploy/shared-host/edge.prod.conf.template');
    expect(stage).toContain('X-Robots-Tag "noindex, nofollow, noarchive" always');
    expect(stage).toContain('location = /robots.txt');
    expect(stage).toContain('Disallow: /');
    expect(prod).not.toMatch(/noindex|nofollow|noarchive|Disallow/);
    for (const edge of [stage, prod]) {
      expect(edge).toContain('access_log off;');
      expect(edge).toContain('error_log /dev/null crit;');
      expect(edge).toContain('gzip off;');
      expect(edge).toContain('client_max_body_size 1048576;');
      expect(edge).toContain('location = /api/event-images');
      expect(edge).toContain('client_max_body_size 5308416;');
      expect(edge).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
      expect(edge).not.toMatch(/proxy_hide_header (Content-Encoding|Vary)/);
    }
    for (const [environment, edge, subnet] of [['staging', stage, '172.30.10'], ['prod', prod, '172.30.20']]) {
      expect(edge).toContain(`server_name \${GONES_${environment.toUpperCase()}_HOST};`);
      expect(edge).toContain(`ssl_certificate /etc/gones/edge/tls/${environment}/fullchain.pem;`);
      expect(edge).toContain(`ssl_certificate_key /etc/gones/edge/tls/${environment}/privkey.pem;`);
      for (const route of ['= /api/event-images', '/api/', '= /health/live']) {
        expect(edge).toContain(`location ${route} {${route.includes('event-images') ? '\n    client_max_body_size 5308416;' : ''}\n    proxy_pass http://${subnet}.10:8080;`);
      }
      expect(edge).toContain(`location / {\n    proxy_pass http://${subnet}.20:8080;`);
      expect(edge).not.toContain(subnet === '172.30.10' ? '172.30.20.' : '172.30.10.');
    }
    expect(read('docs/SHARED_HOST.md')).toContain('DEPLOYMENT BLOCKED');
  });

  it('suppresses downstream frontend token logs while preserving runtime entrypoint/include', () => {
    const main = read('deploy/shared-host/frontend-nginx.conf');
    expect(main).toContain('access_log off;');
    expect(main).toContain('error_log /dev/null crit;');
    expect(main).toContain('include /etc/nginx/conf.d/*.conf;');
    for (const environment of ['staging', 'prod']) {
      const frontend = render(environment).services['frontend'];
      expect(frontend.volumes).toEqual([{
        type: 'bind', source: join(root, 'deploy/shared-host/frontend-nginx.conf'), target: '/etc/nginx/nginx.conf',
        read_only: true, bind: { create_host_path: false }
      }]);
      expect(frontend.entrypoint ?? null).toBeNull();
    }
  });
});
