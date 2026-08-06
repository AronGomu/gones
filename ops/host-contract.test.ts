import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * C41 host contract.
 *
 * Hosting is deliberately undecided, so the repository — not a vendor console — has to carry the
 * complete list of what a generic host must provide, plus the registry-neutral build that produces
 * the artifacts. These assertions keep that documentation and pipeline from silently rotting.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string): string => readFileSync(join(root, file), 'utf8');

describe('runtime configuration surface', () => {
  const runtimeKeys = [
    'GONES_DB_CONNECTION',
    'GONES_DB_CONNECTION_FILE',
    'GONES_ALLOWED_ORIGINS',
    'GONES_FORWARDED_PROXIES',
    'GONES_FORWARDED_PROXY_HOP_LIMIT',
    'GONES_AUTH_SIGNING_KEY_FILE',
    'GONES_SHUTDOWN_TIMEOUT_SECONDS',
    'OTEL_EXPORTER_OTLP_ENDPOINT',
    'GONES_NOTIFICATION_LEASE_SECONDS',
    'GONES_BACKUP_ROOT',
    'GONES_BACKUP_KEY_FILE',
    'GONES_FRONTEND_DATA_MODE',
    'GONES_FRONTEND_API_BASE_URL'
  ];

  it('documents every vendor-neutral runtime key in .env.example', () => {
    const example = read('.env.example');

    for (const key of runtimeKeys) expect(example).toContain(`${key}=`);
  });

  it('documents every vendor-neutral runtime key in the runtime contract', () => {
    const contract = read('docs/RUNTIME_CONTRACT.md');

    for (const key of runtimeKeys) expect(contract).toContain(key);
  });
});

describe('generic host requirements', () => {
  it('states each capability the host must supply', () => {
    const contract = read('docs/RUNTIME_CONTRACT.md');

    for (const requirement of [
      'TLS reverse proxy',
      'Persistent PostgreSQL',
      'Secret injection',
      'Singleton Worker',
      'Migration job',
      'Backup scheduler',
      'OTLP collector',
      'Log retention'
    ]) {
      expect(contract).toContain(requirement);
    }
  });

  it('records the decision as an ADR', () => {
    const adr = read('docs/adr/0018-platform-agnostic-oci-runtime-contract.md');

    expect(adr).toContain('## Status');
    expect(adr).toContain('## Decision');
    expect(adr).toContain('## Consequences');
  });

  it('records the data-authority boundary and the deferred cutover work', () => {
    const adr = read('docs/adr/0019-explicit-legacy-versus-server-data-authority.md');

    expect(adr).toContain('## Status');
    expect(adr).toContain('## Decision');
    expect(adr).toContain('## Consequences');
    for (const deferred of ['domain', 'CDN', 'registry', 'cutover', 'soak']) expect(adr).toContain(deferred);

    for (const document of ['README.md', 'DEPLOYMENT.md', 'CONTEXT.md']) {
      expect(read(document)).toContain('legacy-browser');
    }
  });
});

describe('registry-neutral release build', () => {
  it('exposes the ops commands from package.json', () => {
    const manifest = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

    for (const script of ['images:build', 'images:verify', 'images:scan', 'release:rehearsal', 'backup:rehearsal']) {
      expect(manifest.scripts[script]).toBeTruthy();
    }
  });

  it('builds amd64 images with digests, SBOM, checksums, scans and a signing hook', () => {
    const workflow = read('.github/workflows/release-images.yml');

    expect(workflow).toContain('linux/amd64');
    expect(workflow).toContain('images:build');
    expect(workflow).toContain('images:scan');
    expect(workflow).toContain('sbom');
    expect(workflow).toContain('checksums');
    expect(workflow).toContain('trivy');
    expect(workflow).toContain('gitleaks');
    expect(workflow).toContain('cosign');
    // Signing stays a hook until a registry with OIDC exists; it must never run by default.
    expect(workflow).toMatch(/if:\s*\$\{\{\s*vars\.GONES_SIGN_IMAGES\s*==\s*'true'/);
  });

  it('never hard-codes a registry or a signing key', () => {
    const workflow = read('.github/workflows/release-images.yml');

    expect(workflow).not.toMatch(/\.(amazonaws|azurecr|gcr|pkg\.dev)\b/);
    expect(workflow).not.toContain('cosign.key');
    expect(workflow).not.toContain('COSIGN_PRIVATE_KEY');
  });
});
