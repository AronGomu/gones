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
    'GONES_FRONTEND_API_BASE_URL',
    // C44 runtime injection: the same artifact, served on any origin.
    'GONES_DATA_MODE',
    'GONES_API_BASE_URL',
    'GONES_AUTH_V1',
    'GONES_ADMIN_V1'
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
  });

  it('records the retirement of the browser data authority, and the docs agree', () => {
    const adr = read('docs/adr/0020-retire-the-legacy-browser-data-authority.md');

    expect(adr).toContain('## Status');
    expect(adr).toContain('Supersedes ADR 0019');
    expect(adr).toContain('## Decision');
    expect(adr).toContain('## Consequences');
    // The one-way door has to be written down where an operator will meet it.
    expect(adr).toContain('no longer any way to produce a migration bundle');

    for (const document of ['README.md', 'DEPLOYMENT.md', 'CONTEXT.md']) {
      expect(read(document)).toContain('ADR 0020');
    }
  });
});

describe('operator runbook', () => {
  const runbook = () => read('docs/OPERATIONS.md');

  it('covers every procedure an operator has to perform', () => {
    for (const procedure of [
      'Local environment',
      'OpenAPI and the generated client',
      'Deploying a version',
      'Rollback principles',
      'Secret rotation',
      'Provider delivery webhook',
      'Backup and restore',
      'Running a schema migration',
      'Importing legacy browser data',
      'Admin bootstrap',
      'Observability'
    ]) {
      expect(runbook()).toContain(procedure);
    }
  });

  it('names the local rehearsal behind each procedure instead of asserting it in prose', () => {
    for (const command of [
      'npm run release:rehearsal',
      'npm run backup:rehearsal',
      'npm run migration:smoke',
      'npm run images:verify',
      'npm run acceptance:matrix'
    ]) {
      expect(runbook()).toContain(command);
    }
  });

  it('marks the live-host steps deferred rather than implying they were validated', () => {
    for (const deferred of [
      'registry',
      'public domain',
      'point-in-time recovery',
      'real deliverability',
      'live cutover'
    ]) {
      expect(runbook().toLowerCase()).toContain(deferred.toLowerCase());
    }
    // A local rehearsal must never be presented as a recovery objective.
    expect(runbook()).toMatch(/not a recovery objective|no measured recovery objective/i);
  });

  it('is reachable from the entry-point documents', () => {
    for (const document of ['README.md', 'DEPLOYMENT.md', 'docs/RUNTIME_CONTRACT.md']) {
      expect(read(document)).toContain('OPERATIONS.md');
    }
  });
});

describe('release candidate notes', () => {
  const notes = (): string => read('docs/RELEASE_NOTES_V1.md');

  it('says what the candidate is and how anyone can reproduce it', () => {
    for (const section of [
      'What the candidate is',
      'How to reproduce the candidate',
      'Portability',
      'Known residuals',
      'Deferred live infrastructure',
      'Evidence index'
    ]) {
      expect(notes()).toContain(section);
    }
    expect(notes()).toContain('npm run release:candidate');
  });

  it('backs every claim in the evidence index with a script that exists', () => {
    const manifest = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const evidence = notes().slice(notes().indexOf('## Evidence index'));
    const commands = [...evidence.matchAll(/`npm run ([\w:-]+)`/g)].map((match) => match[1]);

    expect(commands.length).toBeGreaterThan(5);
    for (const command of commands) expect(manifest.scripts[command]).toBeTruthy();
  });

  it('carries the known residuals forward instead of quietly dropping them', () => {
    for (const residual of [
      'notification.acknowledgement.failed',
      '24-hour reconcile',
      'nginx-alpine base',
      '`linux/amd64` only',
      'Cosign signing hook is inert',
      'point-in-time recovery are absent',
      'edge or global rate limiter',
      'fonts.googleapis.com',
      'sanitizer allowlists',
      'development-only'
    ]) {
      expect(notes().toLowerCase()).toContain(residual.toLowerCase());
    }
  });

  it('keeps every live-infrastructure item deferred and unchecked', () => {
    const deferred = notes().slice(notes().indexOf('## Deferred live infrastructure'), notes().indexOf('## Evidence index'));
    const boxes = [...deferred.matchAll(/^- \[( |x)\]/gm)].map((match) => match[1]);

    expect(boxes.length).toBeGreaterThan(8);
    // A ticked box here would be a live claim nothing in this repository can support.
    expect(boxes.every((box) => box === ' ')).toBe(true);
    for (const item of ['registry', 'public domain', 'oauth', 'deliverability', 'recovery objectives', 'cutover']) {
      expect(deferred.toLowerCase()).toContain(item);
    }
  });

  it('never presents a local rehearsal as a live validation', () => {
    expect(notes()).toMatch(/not\b[^.]*a recovery objective/i);
    expect(notes()).toContain('nothing here validates a live provider');
  });

  it('is reachable from the entry-point documents', () => {
    for (const document of ['README.md', 'DEPLOYMENT.md', 'docs/OPERATIONS.md']) {
      expect(read(document)).toContain('RELEASE_NOTES_V1.md');
    }
  });
});

describe('registry-neutral release build', () => {
  it('exposes the ops commands from package.json', () => {
    const manifest = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

    for (const script of ['images:build', 'images:verify', 'images:scan', 'release:preflight', 'release:candidate', 'release:rehearsal', 'backup:rehearsal', 'acceptance:matrix']) {
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
