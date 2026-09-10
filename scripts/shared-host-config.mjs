#!/usr/bin/env node
// Config-only static checks. No secret contents, Docker daemon, image pulls or deployments.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serviceNames = ['api', 'backup', 'frontend', 'migrator', 'otel-collector', 'permissions', 'worker'];
const appSecrets = {
  GONES_DB_CONNECTION_FILE: 'db-app', GONES_AUTH_SIGNING_KEY_FILE: 'auth-signing',
  GONES_EVENT_IMAGES_S3_ACCESS_KEY_FILE: 'object-access', GONES_EVENT_IMAGES_S3_SECRET_KEY_FILE: 'object-secret',
  GONES_WORKER_WAKE_TOKEN_FILE: 'worker-wake-token'
};
const secretKeys = {
  api: { ...appSecrets, GONES_GOOGLE_CLIENT_SECRET_FILE: 'google-secret', GONES_FACEBOOK_CLIENT_SECRET_FILE: 'facebook-secret', GONES_BREVO_WEBHOOK_PATH_TOKEN_FILE: 'webhook-token' },
  worker: { ...appSecrets, GONES_BREVO_API_KEY_FILE: 'brevo-key' },
  migrator: { GONES_DB_CONNECTION_FILE: 'db-migration' },
  permissions: { PGSERVICEFILE: 'db-permissions-service' },
  backup: { GONES_BACKUP_DSN_FILE: 'db-backup', GONES_BACKUP_KEY_FILE: 'backup-key' },
  'otel-collector': {}, frontend: {}
};
const users = { api: '1654:1654', worker: '1654:1654', migrator: '1654:1654', permissions: '65532:65532', backup: '65532:65532', frontend: '101:101', 'otel-collector': '10001:10001' };
const ceilings = { api: [0.5, 512], worker: [0.35, 384], frontend: [0.1, 64], 'otel-collector': [0.15, 192], migrator: [0.5, 384], permissions: [0.25, 128], backup: [0.5, 384] };
const steadyServices = ['api', 'worker', 'frontend', 'otel-collector'];
const equalSet = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
const imagePattern = /^[a-z0-9.-]+(?::\d+)?\/[a-z0-9/_.-]+@sha256:[a-f0-9]{64}$/;
const originPattern = /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/;

/** Evaluate full JSON from Compose, not the fake-only preflight's lossy normalized view. */
export function validateSharedHost(staging, prod) {
  const findings = [];
  for (const [environment, config, subnet] of [['staging', staging, '172.30.10'], ['prod', prod, '172.30.20']]) {
    // Messages name fixed policy fields only, never user-supplied values or raw Compose errors.
    const check = (condition, rule) => { if (!condition) findings.push(`${environment}: ${rule}`); };
    const services = config?.services ?? {};
    check(config?.name === `gones-${environment}`, 'project name');
    check(equalSet(Object.keys(services), serviceNames), 'service inventory');
    check(equalSet(Object.keys(config?.networks ?? {}), ['core', 'edge']), 'network inventory');
    check(config?.networks?.edge?.external === true && config.networks.edge.name === `gones-${environment}-edge`, 'host-owned edge network');
    check(config?.networks?.core?.name === `gones-${environment}-core` && !config.networks.core.external, 'private app network');
    check(!config?.volumes && !config?.configs, 'no shared volumes/configs');
    const environmentSecretKeys = Object.fromEntries(Object.entries(secretKeys).map(([name, keys]) => [name, {
      ...keys, ...(environment === 'staging' && ['api', 'worker'].includes(name)
        ? { GONES_STAGING_POLICY_FILE: 'staging-policy', GONES_BOOTSTRAP_ADMIN_EMAIL_FILE: 'bootstrap-admin-email' } : {})
    }]));
    const expectedSecrets = new Set(['otel-auth', ...Object.values(environmentSecretKeys).flatMap((keys) => Object.values(keys))]);
    check(equalSet(Object.keys(config?.secrets ?? {}), expectedSecrets), 'secret inventory');
    for (const name of expectedSecrets) {
      const secret = config?.secrets?.[name];
      check(secret?.file === `/etc/gones/${environment}/secrets/${name}` && Object.keys(secret).every((key) => ['name', 'file'].includes(key)), 'environment secret source');
    }
    for (const name of serviceNames) {
      const service = services[name];
      if (!service) continue;
      const env = service.environment ?? {};
      const isApp = ['api', 'worker'].includes(name);
      const keys = environmentSecretKeys[name];
      const runtimeEnv = {
        ...(isApp ? { GONES_DEPLOYMENT_ENVIRONMENT: environment === 'staging' ? 'staging' : 'production',
          GONES_WORKER_IDLE_MODE: 'false', GONES_WORKER_WAKE_SOCKET: `/run/gones-worker-${environment}/wake.sock` } : {}),
        ...(name === 'api' ? { ASPNETCORE_ENVIRONMENT: 'Production' }
          : ['worker', 'migrator'].includes(name) ? { DOTNET_ENVIRONMENT: 'Production' } : {})
      };
      for (const [key, value] of Object.entries(runtimeEnv)) check(env[key] === value, `${name} runtime environment`);
      if (isApp) check(service.command == null && service.entrypoint == null && service.healthcheck == null, `${name} inherited startup and health`);
      check(imagePattern.test(service.image ?? '') && service.pull_policy === 'never', `${name} immutable preloaded image`);
      check(service.platform === 'linux/amd64' && service.user === users[name], `${name} platform/UID`);
      for (const key of ['build', 'ports', 'network_mode', 'pid', 'ipc', 'privileged', 'devices', 'volumes_from', 'env_file', 'configs', 'cap_add', 'extra_hosts', 'container_name', 'use_api_socket', 'post_start', 'pre_stop']) {
        check(!service[key], `${name} forbidden authority field`);
      }
      check(service.read_only === true && equalSet(service.cap_drop ?? [], ['ALL']) && equalSet(service.security_opt ?? [], ['no-new-privileges:true']), `${name} hardening`);
      check(Number(service.cpus) > 0 && Number(service.cpus) <= ceilings[name][0] && service.mem_limit > 0 && service.mem_limit <= ceilings[name][1] * 1024 * 1024
        && service.memswap_limit === service.mem_limit && service.pids_limit > 0 && service.pids_limit <= 128, `${name} resource bounds`);
      check(service.tmpfs?.length > 0 && service.tmpfs.every((mount) => /size=\d+m/.test(mount)), `${name} bounded tmpfs`);
      check(service.logging?.driver === 'json-file' && service.logging?.options?.['max-size'] === '5m' && service.logging?.options?.['max-file'] === '2', `${name} log bounds`);
      check(equalSet(Object.keys(service.networks ?? {}), name === 'api' ? ['core', 'edge'] : name === 'frontend' ? ['edge'] : ['core']), `${name} network attachments`);
      const mounts = service.secrets ?? [];
      const expected = name === 'otel-collector' ? ['otel-auth'] : Object.values(keys);
      check(equalSet(mounts.map((mount) => mount.source), expected), `${name} secret scope`);
      for (const mount of mounts) check(mount.target === `/run/secrets/gones-${environment}/${mount.source}`, `${name} secret target`);
      for (const [key, secret] of Object.entries(keys)) check(env[key] === `/run/secrets/gones-${environment}/${secret}`, `${name} required secret file`);
      for (const key of Object.keys(env)) {
        if (/^(?:GONES_(?:DEPLOYMENT_ENVIRONMENT|STAGING_.*|BOOTSTRAP_ADMIN_.*|WORKER_.*)|ASPNETCORE_ENVIRONMENT|DOTNET_ENVIRONMENT)$/i.test(key)) {
          check(Object.hasOwn(runtimeEnv, key) || Object.hasOwn(keys, key), `${name} runtime environment`);
        }
        if (key.endsWith('_FILE') || key === 'PGSERVICEFILE') check(key in keys, `${name} unsupported secret file`);
        else check(!/(?:PASSWORD|SIGNING_KEY|CLIENT_SECRET|API_KEY|PATH_TOKEN|S3_ACCESS_KEY|S3_SECRET_KEY|BACKUP_KEY|BACKUP_DSN|DB_CONNECTION|WORKER_WAKE_TOKEN|BOOTSTRAP_ADMIN_EMAIL)$/i.test(key), `${name} direct secret forbidden`);
        check(!/ALLOW_TEST|FAULT_INJECTION|OAUTH_.*_ENDPOINT|NOTIFICATION_POLL|BREVO_API_BASE_URL/.test(key), `${name} test/provider override forbidden`);
      }
      const volumes = service.volumes ?? [];
      check(volumes.length === (name === 'migrator' ? 0 : 1), `${name} volume inventory`);
      for (const volume of volumes) {
        const [source, target] = isApp ? [`/var/lib/gones/${environment}/worker-wake`, `/run/gones-worker-${environment}`]
          : name === 'permissions' ? [join(root, 'deploy/shared-host/grants.sql'), '/etc/gones/grants.sql']
          : name === 'backup' ? [`/var/lib/gones/${environment}/backups`, '/backups']
            : name === 'frontend' ? [join(root, 'deploy/shared-host/frontend-nginx.conf'), '/etc/nginx/nginx.conf']
              : [`/etc/gones/${environment}/telemetry/collector.yaml`, '/etc/otelcol-contrib/config.yaml'];
        check(volume.type === 'bind' && volume.source === source && volume.target === target && volume.bind?.create_host_path === false
          && Boolean(volume.read_only) === (!['backup', 'worker'].includes(name)), `${name} fixed scoped bind`);
      }
    }
    check(steadyServices.reduce((sum, name) => sum + Number(services[name]?.mem_limit ?? 0), 0) <= 1152 * 1024 * 1024, 'aggregate steady memory ceiling');
    const api = services.api?.environment ?? {};
    const worker = services.worker?.environment ?? {};
    const frontend = services.frontend?.environment ?? {};
    const origin = api.GONES_PUBLIC_APP_ORIGIN;
    check(originPattern.test(origin ?? ''), 'exact HTTPS DNS origin');
    check(api.GONES_ALLOWED_ORIGINS === origin && api.GONES_OAUTH_CALLBACK_ORIGIN === origin && frontend.GONES_API_BASE_URL === origin
      && worker.GONES_PUBLIC_APP_ORIGIN === origin && worker.GONES_ALLOWED_ORIGINS === origin, 'same-origin runtime');
    check(api.GONES_AUTH_PROVIDER === 'External' && worker.GONES_AUTH_PROVIDER === 'Local' && worker.GONES_EMAIL_TRANSPORT === 'Brevo', 'live provider modes');
    check(frontend.GONES_DATA_MODE === 'server' && frontend.GONES_AUTH_V1 === 'true' && frontend.GONES_ADMIN_V1 === 'true', 'frontend authority');
    for (const env of [api, worker]) {
      check(env.GONES_EVENT_IMAGES_S3_REGION === 'auto' && /^https:\/\/[a-z0-9]+\.eu\.r2\.cloudflarestorage\.com$/.test(env.GONES_EVENT_IMAGES_S3_ENDPOINT ?? ''), 'EU R2 endpoint');
      check(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.GONES_EVENT_IMAGES_S3_BUCKET ?? ''), 'private bucket name');
      check(env.GONES_EVENT_IMAGES_S3_BUCKET === api.GONES_EVENT_IMAGES_S3_BUCKET && env.GONES_EVENT_IMAGES_S3_ENDPOINT === api.GONES_EVENT_IMAGES_S3_ENDPOINT, 'app object config parity');
      check(env.OTEL_EXPORTER_OTLP_ENDPOINT === 'http://otel-collector:4317' && env.OTEL_EXPORTER_OTLP_PROTOCOL === 'grpc', 'private OTLP endpoint');
    }
    check(api.GONES_FORWARDED_PROXIES === `${subnet}.2` && api.GONES_FORWARDED_PROXY_HOP_LIMIT === '1', 'exact edge trust');
    check(services.api?.networks?.edge?.ipv4_address === `${subnet}.10` && services.frontend?.networks?.edge?.ipv4_address === `${subnet}.20`, 'fixed edge upstreams');
    check(services.worker?.deploy?.replicas === 1, 'singleton Worker');
    check(services.permissions?.depends_on?.migrator?.condition === 'service_completed_successfully', 'migration before grants');
    for (const name of ['api', 'worker']) check(services[name]?.depends_on?.permissions?.condition === 'service_completed_successfully', 'grants before app');
    check(services.frontend?.depends_on?.api?.condition === 'service_healthy', 'API liveness before frontend');
    check(services.permissions?.image === services.backup?.image, 'reuse backup client image');
  }
  for (const [service, keys] of [['api', ['GONES_PUBLIC_APP_ORIGIN', 'GONES_EVENT_IMAGES_S3_BUCKET', 'GONES_GOOGLE_CLIENT_ID', 'GONES_FACEBOOK_CLIENT_ID']], ['worker', ['GONES_BREVO_SENDER_EMAIL']]]) {
    for (const key of keys) {
      const left = staging?.services?.[service]?.environment?.[key];
      const right = prod?.services?.[service]?.environment?.[key];
      if (!left || !right || left === right) findings.push(`isolation: distinct ${key} required`);
    }
  }
  return findings;
}

export function readSharedHost(environment, fixture = false) {
  const env = fixture ? { PATH: process.env.PATH, HOME: process.env.HOME } : process.env;
  const result = spawnSync('docker', ['compose', '--env-file', fixture ? 'deploy/shared-host/config.fixture.env' : '/dev/null', '-p', `gones-${environment}`,
    '-f', `compose.${environment}.yaml`, '--profile', 'tools', 'config', '--format', 'json'], { cwd: root, env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`shared-host: ${environment} Compose config failed; check required inputs privately`);
  return JSON.parse(result.stdout);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--fixture')) throw new Error('usage: node scripts/shared-host-config.mjs [--fixture]');
    const fixture = args[0] === '--fixture';
    const findings = validateSharedHost(readSharedHost('staging', fixture), readSharedHost('prod', fixture));
    if (findings.length) throw new Error(findings.join('\n'));
    console.log('shared-host: static contract passed; deployment gates remain unverified');
  } catch (error) {
    // Do not echo Compose stderr/config, which may contain operator mistakes involving secrets.
    console.error(error instanceof SyntaxError ? 'shared-host: invalid Compose JSON' : error.message);
    process.exitCode = 1;
  }
}
