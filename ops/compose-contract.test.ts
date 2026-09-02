import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const compose = readFileSync(join(root, 'compose.yaml'), 'utf8');

function serviceBlock(name: string, nextName: string): string {
  const start = compose.indexOf(`  ${name}:`);
  const end = compose.indexOf(`  ${nextName}:`, start + 1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return compose.slice(start, end);
}

describe('local event image object storage', () => {
  it('runs private MinIO with persistent object and generated-secret volumes', () => {
    const minio = serviceBlock('minio', 'event-image-bucket-bootstrap');

    expect(minio).toContain('minio/minio:');
    expect(minio).toContain('event-image-data:/data');
    expect(minio).toContain('event-image-secrets:');
    expect(minio).not.toMatch(/^\s+ports:/m);
    expect(compose).toContain('event-image-data:');
    expect(compose).toContain('event-image-secrets:');
    expect(compose).not.toContain('local-development-only-minio-secret');
  });

  it('bootstraps the required private bucket idempotently', () => {
    const bootstrap = serviceBlock('event-image-bucket-bootstrap', 'api');

    expect(bootstrap).toContain('gones-event-images');
    expect(bootstrap).toContain('mc mb --ignore-existing');
    expect(bootstrap).toContain('mc anonymous set none');
    expect(bootstrap).not.toMatch(/^\s+ports:/m);
  });

  it('wires API and Worker through mounted credential files after bootstrap', () => {
    for (const [name, nextName] of [
      ['api', 'worker'],
      ['worker', 'otel-collector']
    ]) {
      const service = serviceBlock(name, nextName);
      expect(service).toContain('GONES_EVENT_IMAGES_S3_ENDPOINT');
      expect(service).toContain('GONES_EVENT_IMAGES_S3_BUCKET');
      expect(service).toContain('GONES_EVENT_IMAGES_S3_REGION');
      expect(service).toContain('GONES_EVENT_IMAGES_S3_ACCESS_KEY_FILE');
      expect(service).toContain('GONES_EVENT_IMAGES_S3_SECRET_KEY_FILE');
      expect(service).toContain('event-image-secrets:');
      expect(service).toContain('event-image-bucket-bootstrap: { condition: service_completed_successfully }');
    }
  });
});
