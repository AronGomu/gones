import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(__dirname, 'admin-home.component.ts'), 'utf8');

const CARD_NAMES = ['users', 'organizations', 'audit', 'notification-history', 'notification-dead-letters', 'deleted-events'];

describe('AdminHomeComponent template', () => {
  it('renders a card per destination', () => {
    for (const name of CARD_NAMES) {
      expect(source, `missing card: admin-card-${name}`).toContain(`data-cy="admin-card-${name}"`);
    }
  });

  it('each card has a title and a description', () => {
    for (const name of CARD_NAMES) {
      expect(source, `missing title: admin-card-${name}-title`).toContain(`data-cy="admin-card-${name}-title"`);
      expect(source, `missing desc: admin-card-${name}-desc`).toContain(`data-cy="admin-card-${name}-desc"`);
    }
  });
});
