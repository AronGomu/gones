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
    'GONES_RELEASE_VERSION',
    'GONES_RELEASE_DIGEST',
    'GONES_DEPLOYMENT_ENVIRONMENT',
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

  it('keeps hosted collector credentials runtime-only', () => {
    const collector = read('deploy/otel-collector-hosted.yaml');

    expect(collector).toContain('basicauth/grafana');
    expect(collector).toContain('${env:GRAFANA_CLOUD_INSTANCE_ID}');
    expect(collector).toContain('${env:GRAFANA_CLOUD_API_KEY}');
    expect(collector).toContain('${env:GRAFANA_CLOUD_OTLP_ENDPOINT}');
    expect(collector).toContain('otlphttp/grafana');
    expect(collector).not.toContain('debug:');
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

    for (const document of ['README.md', 'DEPLOYMENT.md', 'docs/CONTEXT.md']) {
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
      'Registry publication is GHCR-only',
      'point-in-time recovery are absent',
      'edge or global rate limiter',
      'fonts.googleapis.com',
      'sanitizer allowlists',
      'development-only'
    ]) {
      expect(notes().toLowerCase()).toContain(residual.toLowerCase());
    }
  });

  it('keeps every unproved live-infrastructure item deferred and unchecked', () => {
    const deferred = notes().slice(notes().indexOf('## Deferred live infrastructure'), notes().indexOf('## Evidence index'));
    const lines = deferred.split('\n').filter((line) => !line.includes('Publish candidate images to GHCR'));
    const boxes = lines.flatMap((line) => [...line.matchAll(/^- \[( |x)\]/gm)].map((match) => match[1]));

    expect(boxes.length).toBeGreaterThan(8);
    // A ticked box here would be a live claim nothing in this repository can support.
    expect(boxes.every((box) => box === ' ')).toBe(true);
    for (const item of ['host and orchestrator', 'public domain', 'oauth', 'deliverability', 'recovery objectives', 'cutover']) {
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

describe('deployment documentation boundaries', () => {
  it('does not claim retired backend-free verification', () => {
    const deployment = read('DEPLOYMENT.md');
    const verification = deployment.slice(deployment.indexOf('## 2. Verify the deployment'), deployment.indexOf('## 3. If a static host needs a route fallback'));

    expect(verification).toContain('/events` loads from the API');
    expect(verification).toContain('server Archive records');
    expect(verification).toContain('sanctioned local Archive adapter');
    expect(verification).toContain('`gones-archive-local`');
    expect(verification).toMatch(/`leagues`, `league-seasons`,\s+`tournaments`/);
    expect(verification).toContain('sanctioned offline Live adapter');
    expect(verification).toContain('`gones-live` / `tournaments`');
    expect(verification).toContain('`local-` id');
    expect(verification).toMatch(/no new\s+browser migration bundle is produced/);
    expect(verification).not.toMatch(/browser storage[^.\n]*contains only/i);
    expect(verification).not.toMatch(/without signing in|no `\/api\/` request/i);
  });

  it('distinguishes Pages publication from full-stack release', () => {
    const deployment = read('DEPLOYMENT.md');
    const workflowBoundary = deployment.slice(deployment.indexOf('## Current workflow boundaries'), deployment.indexOf('## 1. Serve it from the release image'));
    const pagesVerification = deployment.slice(deployment.indexOf('A Pages deployment can verify'), deployment.indexOf('## 3. If a static host needs a route fallback'));
    const pagesWorkflow = read('.github/workflows/deploy-pages.yml');
    const ciWorkflow = read('.github/workflows/static.yml');
    const releaseWorkflow = read('.github/workflows/release-images.yml');
    const promotionWorkflow = read('.github/workflows/promote-main.yml');

    expect(workflowBoundary).toContain('GitHub Pages is **static publication only**');
    expect(workflowBoundary).toContain('does not prove a production release');
    expect(workflowBoundary).toContain('cannot be used as evidence');
    expect(pagesVerification).toContain('cannot verify API');
    expect(pagesVerification).toContain('full-stack production readiness');

    const promotion = workflowBoundary.slice(workflowBoundary.indexOf('### Immutable promotion workflow'));
    expect(promotion).toContain('dev → staging → main');
    expect(promotion).toContain('immutable GHCR images');
    expect(promotion).toContain('without rebuilding');
    expect(promotion).toContain('release:promotion-check');
    expect(promotion).toContain('No production deployment is claimed here');

    expect(pagesWorkflow).toContain('actions/upload-pages-artifact');
    expect(pagesWorkflow).toContain('actions/deploy-pages');
    expect(ciWorkflow).toContain('npm run e2e:ci');
    expect(releaseWorkflow).toContain('npm run images:verify');
    expect(releaseWorkflow).toContain('release:publish');
    expect(releaseWorkflow).toContain('actions/attest-build-provenance');
    expect(promotionWorkflow).toContain('node scripts/production-handoff.mjs');
    expect(promotionWorkflow).toContain('ref: ${{ github.sha }}');
    expect(promotionWorkflow).not.toContain('git push');
  });
});

describe('immutable registry release build', () => {
  it('exposes the ops commands from package.json', () => {
    const manifest = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

    for (const script of ['images:build', 'images:verify', 'images:scan', 'release:preflight', 'release:publish', 'release:verify-published', 'release:deploy-staging', 'release:promotion-check', 'release:candidate', 'release:rehearsal', 'backup:rehearsal', 'acceptance:matrix']) {
      expect(manifest.scripts[script]).toBeTruthy();
    }
  });

  it('builds once, publishes immutable digests, attests and signs them', () => {
    const workflow = read('.github/workflows/release-images.yml');

    expect(workflow).toContain('linux/amd64');
    expect(workflow).toContain('images:build');
    expect(workflow).toContain('release:publish');
    expect(workflow).toContain('release:verify-published');
    expect(workflow).toContain('actions/attest-build-provenance');
    expect(workflow).toContain('checksums');
    expect(workflow).toContain('trivy');
    expect(workflow).toContain('gitleaks');
    expect(workflow).toContain('cosign sign --yes');
    expect(workflow).toContain('GONES_IMAGE_REGISTRY: ghcr.io');
    expect(workflow).toContain('GONES_IMAGE_REFERENCE: ${{ github.sha }}');
  });

  it('uses no private signing key and never tags latest', () => {
    const workflow = read('.github/workflows/release-images.yml');

    expect(workflow).not.toContain('cosign.key');
    expect(workflow).not.toContain('COSIGN_PRIVATE_KEY');
    expect(workflow).not.toContain(':latest');
  });

  it('serializes staging deploy and invokes only fixed operation', () => {
    const workflow = read('.github/workflows/release-images.yml');

    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('environment: staging');
    expect(workflow).toContain('release:deploy-staging');
    expect(workflow).not.toContain('run: npm run release:promotion-check');
    expect(workflow).toContain('staging-deployment-evidence-${{ github.sha }}');
    const finalizer = read('.github/workflows/finalize-staging.yml');
    expect(finalizer).toContain('node scripts/finalize-staging.mjs');
    expect(finalizer).toContain('staging-promotion-evidence-${{ github.sha }}');
    expect(workflow).not.toContain('docker compose up');
    expect(workflow).not.toContain('ssh ');
  });
});
