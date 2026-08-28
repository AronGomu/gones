import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * C41 image contract.
 *
 * The V1 runtime artifacts must stay platform-agnostic: plain Linux OCI images that a generic
 * container host can run with nothing but environment variables, mounted secret files and a
 * TLS-terminating reverse proxy. These assertions read the shipped build files, so they fail the
 * moment an image drifts back towards a vendor runtime, a root user, or a floating base tag.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string): string => readFileSync(join(root, file), 'utf8');

interface RuntimeImage {
  readonly name: string;
  readonly dockerfile: string;
  readonly title: string;
  readonly user: string;
  readonly stopSignal: string;
  readonly healthPath?: string;
}

const runtimeImages: readonly RuntimeImage[] = [
  { name: 'api', dockerfile: 'backend/src/Gones.Api/Dockerfile', title: 'gones-api', user: '1654:1654', stopSignal: 'SIGTERM', healthPath: '/health/live' },
  { name: 'worker', dockerfile: 'backend/src/Gones.Worker/Dockerfile', title: 'gones-worker', user: '1654:1654', stopSignal: 'SIGTERM' },
  { name: 'migrator', dockerfile: 'backend/src/Gones.Migrator/Dockerfile', title: 'gones-migrator', user: '1654:1654', stopSignal: 'SIGTERM' },
  { name: 'backup', dockerfile: 'deploy/backup/Dockerfile', title: 'gones-backup', user: '65532:65532', stopSignal: 'SIGTERM' },
  // nginx drains in-flight requests on SIGQUIT; SIGTERM is its abrupt shutdown.
  { name: 'frontend', dockerfile: 'Dockerfile', title: 'gones-frontend', user: '101:101', stopSignal: 'SIGQUIT', healthPath: '/health' }
];

const DIGEST = /@sha256:[0-9a-f]{64}\b/;

interface Stage {
  readonly name: string;
  readonly from: string;
  readonly body: readonly string[];
}

function parse(dockerfile: string): { args: Map<string, string>; stages: Stage[] } {
  const lines = read(dockerfile)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  const args = new Map<string, string>();
  const stages: Stage[] = [];
  for (const line of lines) {
    const argMatch = /^ARG\s+([A-Z0-9_]+)=(.+)$/.exec(line);
    if (argMatch && stages.length === 0) args.set(argMatch[1], argMatch[2]);
    const fromMatch = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?$/i.exec(line);
    if (fromMatch) {
      stages.push({ name: fromMatch[2] ?? `stage-${stages.length}`, from: fromMatch[1], body: [] });
      continue;
    }
    if (stages.length > 0) (stages[stages.length - 1].body as string[]).push(line);
  }
  return { args, stages };
}

function resolveBase(reference: string, args: Map<string, string>): string {
  return reference.replace(/\$\{?([A-Z0-9_]+)\}?/g, (_match, key: string) => args.get(key) ?? '');
}

describe.each(runtimeImages)('$name image', (image) => {
  it('pins every external base image to an immutable digest', () => {
    const { args, stages } = parse(image.dockerfile);
    const stageNames = new Set(stages.map((stage) => stage.name));
    const external = stages
      .map((stage) => stage.from)
      .filter((from) => !stageNames.has(from))
      .map((from) => resolveBase(from, args));

    expect(external.length).toBeGreaterThan(0);
    for (const base of external) expect(base).toMatch(DIGEST);
  });

  it('runs the runtime stage as an explicit non-root numeric account', () => {
    const { stages } = parse(image.dockerfile);
    const runtime = stages[stages.length - 1];
    const users = runtime.body.filter((line) => line.startsWith('USER '));

    expect(users[users.length - 1]).toBe(`USER ${image.user}`);
    expect(image.user.startsWith('0:')).toBe(false);
  });

  it('declares the stop signal its process drains on', () => {
    const { stages } = parse(image.dockerfile);
    const runtime = stages[stages.length - 1];

    expect(runtime.body).toContain(`STOPSIGNAL ${image.stopSignal}`);
  });

  it('stays compatible with a read-only root filesystem', () => {
    const dockerfile = read(image.dockerfile);

    expect(dockerfile).not.toMatch(/^\s*VOLUME\b/m);
    expect(dockerfile).toMatch(/TMPDIR=\/tmp/);
  });

  it('carries OCI provenance labels', () => {
    const dockerfile = read(image.dockerfile);

    expect(dockerfile).toContain(`org.opencontainers.image.title="${image.title}"`);
    for (const label of ['description', 'source', 'licenses', 'vendor', 'revision', 'created']) {
      expect(dockerfile).toContain(`org.opencontainers.image.${label}=`);
    }
  });

  it('declares a health probe when it serves HTTP', () => {
    const dockerfile = read(image.dockerfile);
    if (!image.healthPath) {
      expect(dockerfile).not.toContain('HEALTHCHECK');
      return;
    }
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain(image.healthPath);
  });
});

describe('cloud independence', () => {
  const cloudPackages = [
    'AWSSDK', 'Amazon.', 'Azure.', 'Microsoft.Azure', 'Google.Cloud', 'Google.Apis',
    'AlibabaCloud', 'Oci.', 'Pulumi', 'Serilog.Sinks.AzureAnalytics'
  ];

  it('never takes a cloud provider SDK dependency', () => {
    const manifests = [
      'backend/Directory.Packages.props',
      'backend/src/Gones.Api/packages.lock.json',
      'backend/src/Gones.Worker/packages.lock.json',
      'backend/src/Gones.Migrator/packages.lock.json',
      'backend/src/Gones.Infrastructure/packages.lock.json'
    ];

    for (const manifest of manifests) {
      const content = read(manifest);
      for (const cloudPackage of cloudPackages) expect(content).not.toContain(cloudPackage);
    }
  });

  it('keeps the base images on public, registry-neutral repositories', () => {
    for (const image of runtimeImages) {
      const { args } = parse(image.dockerfile);
      for (const value of args.values()) {
        if (!DIGEST.test(value)) continue;
        expect(value).not.toMatch(/\.(amazonaws|azurecr|gcr|pkg\.dev)\b/);
      }
    }
  });
});

describe('compose runtime hardening', () => {
  const hardenedServices = ['api', 'worker', 'migrator', 'backup'];

  it('keeps the default stack read-only and unprivileged', () => {
    const compose = read('compose.yaml');

    expect(compose).toContain('read_only: true');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).toContain('cap_drop: [ALL]');
  });

  it('ships a release-test profile with a TLS edge and no external egress', () => {
    expect(existsSync(join(root, 'compose.release-test.yaml'))).toBe(true);
    const compose = read('compose.release-test.yaml');

    for (const service of hardenedServices) expect(compose).toContain(`${service}:`);
    expect(compose).toContain('internal: true');
    expect(compose).toContain('tls-proxy:');
    expect(compose).toContain('fake-identity:');
    expect(compose).toContain('fake-brevo:');
    // The API is only reachable through the TLS edge; nothing else publishes a host port.
    const published = [...compose.matchAll(/127\.0\.0\.1:(\d+):/g)].map((match) => match[1]);
    expect(published).toEqual(['8443']);
  });

  it('gives the release-test API the forwarded-proxy and OTLP runtime contract', () => {
    const compose = read('compose.release-test.yaml');

    expect(compose).toContain('GONES_FORWARDED_PROXIES');
    expect(compose).toContain('GONES_DB_CONNECTION_FILE');
    expect(compose).toContain('GONES_AUTH_SIGNING_KEY_FILE');
    expect(compose).toContain('OTEL_EXPORTER_OTLP_ENDPOINT');
  });
});

describe('backup and restore commands', () => {
  it('refuses to write outside the mounted backup root and fails safely on bad input', () => {
    const backup = read('deploy/backup/gones-backup.sh');
    const restore = read('deploy/backup/gones-restore.sh');

    for (const script of [backup, restore]) {
      expect(script.startsWith('#!/bin/sh')).toBe(true);
      expect(script).toContain('set -eu');
      expect(script).toContain('GONES_BACKUP_ROOT');
    }
    expect(backup).toContain('pg_dump');
    expect(backup).toContain('openssl enc');
    expect(restore).toContain('pg_restore');
    // Corruption is caught by the checksum and a wrong key by the plaintext magic, both before the
    // restore ever touches PostgreSQL.
    expect(restore).toContain('sha256sum');
    expect(restore).toContain('PGDMP');
  });

  it('authenticates the ciphertext with an HMAC derived from the same passphrase', () => {
    const backup = read('deploy/backup/gones-backup.sh');
    const restore = read('deploy/backup/gones-restore.sh');

    for (const script of [backup, restore]) {
      expect(script).toContain('-mac HMAC');
      expect(script).toContain('pbkdf2-sha256-600000');
    }
    expect(backup).toContain('.dump.enc.hmac');
    expect(restore).toContain('refusing to restore an unauthenticated archive');
    // The MAC must be verified before any decryption is attempted.
    expect(restore.indexOf('-mac HMAC')).toBeLessThan(restore.indexOf('openssl enc -d'));
  });
});
