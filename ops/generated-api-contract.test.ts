import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const document = JSON.parse(readFileSync(join(root, 'backend/openapi/gones.json'), 'utf8')) as Record<string, unknown>;

function collectReferences(value: unknown, references: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, references);
  } else if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record['$ref'] === 'string') references.push(record['$ref']);
    for (const child of Object.values(record)) collectReferences(child, references);
  }
  return references;
}

function resolveLocalReference(reference: string): unknown {
  if (!reference.startsWith('#/')) return undefined;
  return reference.slice(2).split('/').reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== 'object') return undefined;
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    return (current as Record<string, unknown>)[key];
  }, document);
}

function schema(name: string): Record<string, unknown> {
  const components = document['components'] as Record<string, unknown>;
  const schemas = components['schemas'] as Record<string, Record<string, unknown>>;
  return schemas[name];
}

describe('generated OpenAPI semantics', () => {
  it('keeps every schema reference resolvable', () => {
    const unresolved = collectReferences(document).filter(reference => resolveLocalReference(reference) === undefined);

    expect(unresolved).toEqual([]);
  });

  it('models every NodaTime Instant reference as an RFC 3339 string', () => {
    const instantSchema = { type: 'string', format: 'date-time' };
    const instantReferences = collectReferences(document).filter(reference => reference === '#/components/schemas/Instant');

    expect(instantReferences.length).toBeGreaterThan(0);
    expect(schema('Instant')).toEqual(instantSchema);
    for (const reference of instantReferences) expect(resolveLocalReference(reference)).toEqual(instantSchema);
  });

  it('models manual Event location timezone without provider tokens', () => {
    const locationProperties = schema('EventLocationInput')['properties'] as Record<string, unknown>;
    const managementProperties = schema('EventManagementResponse')['properties'] as Record<string, unknown>;

    expect(locationProperties['timeZoneId']).toEqual({ maxLength: 100, type: 'string' });
    expect(locationProperties).not.toHaveProperty('locationToken');
    expect(managementProperties).not.toHaveProperty('locationTokenExpiresAt');
  });
});
