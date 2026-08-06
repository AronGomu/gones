import { describe, expect, it } from 'vitest';
// @ts-expect-error - the release preflight is a plain ESM script shared with the CLI.
import { MISMATCH_CLASSES, evaluatePreflight } from '../scripts/release-preflight.mjs';

/**
 * C44 release preflight — the RED probe.
 *
 * The preflight is the gate that decides whether a set of built artifacts may be called a release
 * candidate. A gate nobody has seen fail is not a gate, so every mismatch class it claims to catch
 * gets its own failing fixture here: a baseline candidate that passes, then one deliberate defect
 * per class that must be rejected, naming that class.
 *
 * `evaluatePreflight` is a pure function over a context object. That is deliberate: the preflight
 * must never need a public domain, a registry account or a cloud credential to decide, and a pure
 * function cannot acquire one. `scripts/release-preflight.mjs` builds the context from the local
 * filesystem, the local Docker daemon and `docker compose config`; nothing else.
 */

const ORIGIN = 'https://localhost:8443';

const RELEASE_IMAGE_NAMES = ['api', 'worker', 'migrator', 'backup', 'frontend'];

const MIGRATIONS = ['20260724111457_InitialPersistence', '20260724112436_AppendOnlyAuditGuard'];

interface Finding {
  readonly mismatch: string;
  readonly message: string;
}

interface Result {
  readonly ok: boolean;
  readonly findings: readonly Finding[];
}

interface ImageEntry {
  name: string;
  tag: string;
  digest: string;
  os: string;
  architecture: string;
  user: string;
  stopSignal: string;
  labels: Record<string, string>;
}

interface CandidateService {
  image: string;
  healthcheck: boolean;
  environment: Record<string, string>;
  volumes?: string[];
}

interface PreflightContext {
  revision: string;
  images: {
    manifest: {
      platform: string;
      revision: string;
      created: string;
      images: ImageEntry[];
      sbom: { image: string; generated: boolean; reason?: string }[];
      frontend: { dataMode: string; apiBaseUrl: string };
    };
    checksums: string;
    daemon: Record<string, string>;
    scan: Record<string, { critical: number }>;
  };
  migrations: { onDisk: string[]; allowlist: string[]; applied: string[] | null };
  openapi: { snapshotOperations: string[]; clientOperations: string[] };
  candidate: { origin: string; services: Record<string, CandidateService> };
  observed: {
    health: Record<string, string>;
    runtimeConfig: { dataMode: string; apiBaseUrl: string; features: { authV1: boolean; adminV1: boolean } } | null;
    contentSecurityPolicy: string;
    restoreSmoke: string | null;
  } | null;
}

function imageEntry(name: string): ImageEntry {
  return {
    name,
    tag: `gones-${name}:candidate`,
    digest: `sha256:${name.padEnd(64, '0')}`,
    os: 'linux',
    architecture: 'amd64',
    user: name === 'backup' ? '65532:65532' : name === 'frontend' ? '101:101' : '1654:1654',
    stopSignal: name === 'frontend' ? 'SIGQUIT' : 'SIGTERM',
    labels: { 'org.opencontainers.image.title': `gones-${name}` }
  };
}

/** A candidate that is genuinely releasable. Every mutation below starts from this. */
function baseline(): PreflightContext {
  const images = RELEASE_IMAGE_NAMES.map(imageEntry);
  return {
    revision: 'a'.repeat(40),
    images: {
      manifest: {
        platform: 'linux/amd64',
        revision: 'a'.repeat(40),
        created: '2026-08-06T00:00:00Z',
        images,
        sbom: RELEASE_IMAGE_NAMES.map((name) => ({ image: name, generated: true })),
        frontend: { dataMode: 'server', apiBaseUrl: 'https://gones.example' }
      },
      checksums: [
        ...images.map((image) => `${image.digest.slice('sha256:'.length)}  ${image.tag}`),
        ...RELEASE_IMAGE_NAMES.map((name) => `${'b'.repeat(64)}  sbom-${name}.spdx.json`),
        `${'c'.repeat(64)}  manifest.json`
      ].join('\n'),
      daemon: Object.fromEntries(images.map((image) => [image.name, image.digest])),
      scan: Object.fromEntries(RELEASE_IMAGE_NAMES.map((name) => [name, { critical: 0 }]))
    },
    migrations: { onDisk: [...MIGRATIONS], allowlist: [...MIGRATIONS], applied: [...MIGRATIONS] },
    openapi: { snapshotOperations: ['listTournaments', 'register'], clientOperations: ['listTournaments', 'register'] },
    candidate: {
      origin: ORIGIN,
      services: {
        api: {
          image: `gones-api:candidate`,
          healthcheck: true,
          environment: {
            GONES_DB_CONNECTION_FILE: '/secrets/db-connection',
            GONES_AUTH_SIGNING_KEY_FILE: '/secrets/auth-signing-key',
            GONES_ALLOWED_ORIGINS: ORIGIN,
            GONES_PUBLIC_APP_ORIGIN: ORIGIN,
            GONES_FORWARDED_PROXIES: '172.31.240.10',
            GONES_SHUTDOWN_TIMEOUT_SECONDS: '20',
            OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector:4317',
            GONES_OAUTH_GOOGLE_AUTHORIZATION_ENDPOINT: 'https://fake-identity:8443/authorize',
            GONES_OAUTH_GOOGLE_TOKEN_ENDPOINT: 'https://fake-identity:8443/token',
            GONES_OAUTH_GOOGLE_USERINFO_ENDPOINT: 'https://fake-identity:8443/userinfo',
            GONES_OAUTH_FACEBOOK_AUTHORIZATION_ENDPOINT: 'https://fake-identity:8443/authorize',
            GONES_OAUTH_FACEBOOK_TOKEN_ENDPOINT: 'https://fake-identity:8443/token',
            GONES_OAUTH_FACEBOOK_USERINFO_ENDPOINT: 'https://fake-identity:8443/userinfo',
            GONES_FEATURES__API_BACKEND: 'true',
            GONES_FEATURES__CALENDAR_V1: 'true',
            GONES_FEATURES__AUTH_V1: 'true',
            GONES_FEATURES__ADMIN_V1: 'true',
            GONES_FEATURES__LEAGUE_SERVER: 'true',
            GONES_FEATURES__LIVE_SERVER: 'true'
          }
        },
        worker: {
          image: `gones-worker:candidate`,
          healthcheck: false,
          environment: {
            GONES_DB_CONNECTION_FILE: '/secrets/db-connection',
            GONES_NOTIFICATION_LEASE_SECONDS: '120',
            OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector:4317',
            GONES_BREVO_API_BASE_URL: 'https://fake-brevo:8443/v3/',
            GONES_BREVO_API_KEY_FILE: '/secrets/brevo-api-key',
            GONES_FEATURES__API_BACKEND: 'true',
            GONES_FEATURES__CALENDAR_V1: 'true',
            GONES_FEATURES__AUTH_V1: 'true',
            GONES_FEATURES__ADMIN_V1: 'true',
            GONES_FEATURES__LEAGUE_SERVER: 'true',
            GONES_FEATURES__LIVE_SERVER: 'true'
          }
        },
        migrator: { image: `gones-migrator:candidate`, healthcheck: false, environment: { GONES_DB_CONNECTION_FILE: '/secrets/db-connection' } },
        backup: {
          image: `gones-backup:candidate`,
          healthcheck: false,
          environment: { GONES_BACKUP_ROOT: '/backups', GONES_BACKUP_KEY_FILE: '/secrets/backup-key' },
          volumes: ['backups:/backups', 'secrets:/secrets:ro']
        },
        frontend: {
          image: `gones-frontend:candidate`,
          healthcheck: true,
          environment: { GONES_DATA_MODE: 'server', GONES_API_BASE_URL: ORIGIN, GONES_AUTH_V1: 'true', GONES_ADMIN_V1: 'true' }
        }
      }
    },
    observed: {
      health: { api: 'healthy', frontend: 'healthy' },
      runtimeConfig: { dataMode: 'server', apiBaseUrl: ORIGIN, features: { authV1: true, adminV1: true } },
      contentSecurityPolicy: `default-src 'self'; connect-src 'self' ${ORIGIN}; frame-ancestors 'none'`,
      restoreSmoke: 'passed'
    }
  };
}

/** Applies one deliberate defect to a deep-cloned baseline. */
function broken(mutate: (context: PreflightContext) => void): Result {
  const context = structuredClone(baseline());
  mutate(context);
  return evaluatePreflight(context) as Result;
}

const classesOf = (result: Result): string[] => [...new Set(result.findings.map((finding) => finding.mismatch))];

describe('release preflight', () => {
  it('accepts a coherent release candidate', () => {
    const result = evaluatePreflight(baseline()) as Result;

    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('declares exactly the mismatch classes the release ticket requires', () => {
    expect([...MISMATCH_CLASSES].sort()).toEqual([
      'authority-mode',
      'backup',
      'config-schema',
      'fake-provider',
      'feature-flag',
      'health',
      'image-digest',
      'migration',
      'openapi'
    ]);
  });

  describe('image digest mismatches', () => {
    it('rejects a manifest digest the local daemon does not have', () => {
      const result = broken((context) => {
        context.images.daemon['api'] = `sha256:${'9'.repeat(64)}`;
      });

      expect(classesOf(result)).toContain('image-digest');
      expect(result.ok).toBe(false);
    });

    it('rejects a manifest built from a different source revision', () => {
      const result = broken((context) => {
        context.images.manifest.revision = 'f'.repeat(40);
      });

      expect(classesOf(result)).toContain('image-digest');
    });

    it('rejects a digest that is not covered by the checksum file', () => {
      const result = broken((context) => {
        context.images.checksums = context.images.checksums
          .split('\n')
          .filter((line: string) => !line.includes('gones-worker:candidate'))
          .join('\n');
      });

      expect(classesOf(result)).toContain('image-digest');
    });

    it('rejects a release artifact that has no SBOM', () => {
      const result = broken((context) => {
        context.images.manifest.sbom = context.images.manifest.sbom.map((entry) =>
          entry.image === 'migrator' ? { image: 'migrator', generated: false, reason: 'generator unreachable' } : entry);
      });

      expect(classesOf(result)).toContain('image-digest');
    });

    it('rejects a candidate stack running an image that is not in the manifest', () => {
      const result = broken((context) => {
        context.candidate.services['api'].image = 'gones-api:some-other-build';
      });

      expect(classesOf(result)).toContain('image-digest');
    });

    it('rejects an unresolved critical vulnerability in a release artifact', () => {
      const result = broken((context) => {
        context.images.scan['api'] = { critical: 2 };
      });

      expect(classesOf(result)).toContain('image-digest');
    });
  });

  describe('migration mismatches', () => {
    it('rejects a migration on disk that the smoke allowlist does not know', () => {
      const result = broken((context) => {
        context.migrations.onDisk.push('20260806120000_AddSomethingNew');
      });

      expect(classesOf(result)).toContain('migration');
    });

    it('rejects a database whose applied set differs from the shipped migrations', () => {
      const result = broken((context) => {
        context.migrations.applied = [MIGRATIONS[0]];
      });

      expect(classesOf(result)).toContain('migration');
    });
  });

  describe('OpenAPI mismatches', () => {
    it('rejects a generated client that has drifted from the committed contract', () => {
      const result = broken((context) => {
        context.openapi.clientOperations = ['listTournaments'];
      });

      expect(classesOf(result)).toContain('openapi');
    });

    it('rejects a contract operation the shipped client cannot call', () => {
      const result = broken((context) => {
        context.openapi.snapshotOperations.push('cancelTournament');
      });

      expect(classesOf(result)).toContain('openapi');
    });
  });

  describe('config schema mismatches', () => {
    it('rejects a service that is missing a required runtime configuration key', () => {
      const result = broken((context) => {
        delete context.candidate.services['api'].environment['GONES_FORWARDED_PROXIES'];
      });

      expect(classesOf(result)).toContain('config-schema');
    });

    it('rejects a secret passed as a plain environment value instead of a mounted file', () => {
      const result = broken((context) => {
        context.candidate.services['api'].environment['GONES_DB_CONNECTION'] = 'Host=postgres;Password=hunter2';
      });

      expect(classesOf(result)).toContain('config-schema');
    });

    it('rejects a cloud credential in the candidate environment', () => {
      const result = broken((context) => {
        context.candidate.services['worker'].environment['AWS_ACCESS_KEY_ID'] = 'AKIAEXAMPLE';
      });

      expect(classesOf(result)).toContain('config-schema');
    });
  });

  describe('health mismatches', () => {
    it('rejects an artifact that stopped declaring its health probe', () => {
      const result = broken((context) => {
        context.candidate.services['api'].healthcheck = false;
      });

      expect(classesOf(result)).toContain('health');
    });

    it('rejects an observed container that never became healthy', () => {
      const result = broken((context) => {
        context.observed!.health['frontend'] = 'unhealthy';
      });

      expect(classesOf(result)).toContain('health');
    });
  });

  describe('backup mismatches', () => {
    it('rejects a candidate whose backup command has no mounted backup root', () => {
      const result = broken((context) => {
        delete context.candidate.services['backup'].environment['GONES_BACKUP_ROOT'];
      });

      expect(classesOf(result)).toContain('backup');
    });

    it('rejects a candidate whose restore smoke did not pass', () => {
      const result = broken((context) => {
        context.observed!.restoreSmoke = 'failed';
      });

      expect(classesOf(result)).toContain('backup');
    });
  });

  describe('fake provider mismatches', () => {
    it('rejects a live identity provider endpoint', () => {
      const result = broken((context) => {
        context.candidate.services['api'].environment['GONES_OAUTH_GOOGLE_TOKEN_ENDPOINT'] = 'https://oauth2.googleapis.com/token';
      });

      expect(classesOf(result)).toContain('fake-provider');
    });

    it('rejects a live email provider endpoint', () => {
      const result = broken((context) => {
        context.candidate.services['worker'].environment['GONES_BREVO_API_BASE_URL'] = 'https://api.brevo.com/v3/';
      });

      expect(classesOf(result)).toContain('fake-provider');
    });

    it('rejects a candidate that stopped overriding the provider endpoints at all', () => {
      const result = broken((context) => {
        delete context.candidate.services['api'].environment['GONES_OAUTH_GOOGLE_AUTHORIZATION_ENDPOINT'];
      });

      expect(classesOf(result)).toContain('fake-provider');
    });
  });

  describe('authority mode mismatches', () => {
    it('rejects a candidate frontend left in legacy browser authority', () => {
      const result = broken((context) => {
        context.candidate.services['frontend'].environment['GONES_DATA_MODE'] = 'legacy-browser';
      });

      expect(classesOf(result)).toContain('authority-mode');
    });

    it('rejects a runtime configuration that does not match the candidate origin', () => {
      const result = broken((context) => {
        context.observed!.runtimeConfig!.apiBaseUrl = 'https://somewhere.else';
      });

      expect(classesOf(result)).toContain('authority-mode');
    });

    it('rejects a content-security-policy that does not admit the injected origin', () => {
      const result = broken((context) => {
        context.observed!.contentSecurityPolicy = "default-src 'self'; connect-src 'self'";
      });

      expect(classesOf(result)).toContain('authority-mode');
    });

    it('rejects an artifact bound at build time to the single origin it is serving', () => {
      // The whole point of runtime injection: the image default must not be the only origin the
      // artifact can ever serve. If the two are identical nothing proved the injection works.
      const result = broken((context) => {
        context.images.manifest.frontend.apiBaseUrl = ORIGIN;
      });

      expect(classesOf(result)).toContain('authority-mode');
    });
  });

  describe('feature flag mismatches', () => {
    it('rejects a candidate that left a server feature flag disabled', () => {
      const result = broken((context) => {
        context.candidate.services['api'].environment['GONES_FEATURES__LIVE_SERVER'] = 'false';
      });

      expect(classesOf(result)).toContain('feature-flag');
    });

    it('rejects a candidate that never declared a server feature flag', () => {
      const result = broken((context) => {
        delete context.candidate.services['worker'].environment['GONES_FEATURES__CALENDAR_V1'];
      });

      expect(classesOf(result)).toContain('feature-flag');
    });
  });

  it('decides without any observation when the stack has not started yet', () => {
    const context = baseline();
    context.observed = null;

    const result = evaluatePreflight(context) as Result;

    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('needs no credential, registry account or public domain to decide', () => {
    const source = evaluatePreflight.toString();

    expect(source).not.toMatch(/fetch\(|https?:\/\/(?!localhost)/);
    for (const secret of ['AWS_', 'AZURE_', 'GOOGLE_APPLICATION_CREDENTIALS', 'registry']) {
      // The evaluator may name a forbidden key to reject it, but must never read one.
      expect(source).not.toContain(`process.env.${secret}`);
    }
  });
});
