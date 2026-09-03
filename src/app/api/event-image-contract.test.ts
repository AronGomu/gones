import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('singular Event image OpenAPI contract', () => {
  const openapi = JSON.parse(readFileSync(join(process.cwd(), 'backend/openapi/gones.json'), 'utf8'));
  const generated = readFileSync(join(process.cwd(), 'src/app/api/generated/gones-api.ts'), 'utf8');

  it('keeps nullable imageId optional on publish and update requests', () => {
    for (const name of ['EventPayloadRequest', 'UpdateEventDetailsRequest']) {
      const schema = openapi.components.schemas[name];
      expect(schema.required ?? []).not.toContain('imageId');
      expect(schema.properties.imageId.type).toEqual(['null', 'string']);
    }
    expect(generated).toMatch(/export interface EventPayloadRequest[\s\S]*imageId\?: string \| undefined;/);
    expect(generated).toMatch(/export interface UpdateEventDetailsRequest[\s\S]*imageId\?: string \| undefined;/);
  });

  it('exposes singular image responses without alt metadata or plural input type', () => {
    expect(openapi.components.schemas.EventImageInput).toBeUndefined();
    expect(openapi.components.schemas.EventImageResponse.properties).toEqual(expect.objectContaining({ id: expect.anything(), variants: expect.anything() }));
    expect(openapi.components.schemas.EventImageResponse.properties).not.toHaveProperty('altText');
    for (const name of ['PublicEventDetailResponse', 'EventManagementResponse', 'EventProposalReviewResponse']) {
      expect(openapi.components.schemas[name].properties).toHaveProperty('image');
      expect(openapi.components.schemas[name].properties).not.toHaveProperty('images');
    }
  });
});
