import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const journey = readFileSync('deploy/release-test/journeys.mjs', 'utf8');
const releaseCompose = readFileSync('compose.release-test.yaml', 'utf8');
const apiProgram = readFileSync('backend/src/Gones.Api/Program.cs', 'utf8');

describe('release Event publication journey', () => {
  it('publishes EventPayloadRequest directly with an Idempotency-Key', () => {
    expect(journey).toContain("await call('/api/events', {");
    expect(journey).toContain("const idempotent = () => ({ 'Idempotency-Key': randomUUID() })");
    expect(journey).toContain('body: payload');
    expect(journey).toContain('location: {');
    expect(journey).toContain('locationToken: resolved.json.locationToken');
    expect(journey).toContain("eventType: 'major'");
    expect(journey).toContain('images: []');
  });

  it('contains no retired preview ticket journey', () => {
    expect(journey).not.toContain('previewTicket');
    expect(journey).not.toContain('/preview');
  });

  it('keeps location resolution inside deterministic release-test provider', () => {
    expect(releaseCompose).toContain('GONES_EVENT_LOCATION_USE_FAKE: "true"');
    expect(apiProgram).toContain('builder.Configuration.GetValue<bool>("GONES_EVENT_LOCATION_USE_FAKE")');
    expect(journey).toContain("await call('/api/event-locations/resolve'");
  });
});
