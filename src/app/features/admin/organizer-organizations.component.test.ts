import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Same rationale as admin-organizations.component.test.ts: no TestBed / zone.js in this repo, so
// `effect()` is stubbed to a no-op and the component is built with a bare Injector.
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => {} }) };
});

import { Injector, runInInjectionContext } from '@angular/core';
import { of } from 'rxjs';
import { Client, MyOrganizationResponse } from '../../api/generated/gones-api';
import { I18nService } from '../../i18n/i18n.service';
import { DeckArchetypeSettingsService } from '../../shared/deck-archetype-settings.service';
import { OrganizerOrganizationsComponent } from './organizer-organizations.component';

const source = readFileSync(join(__dirname, 'organizer-organizations.component.ts'), 'utf8');

function membership(id: string): MyOrganizationResponse {
  return { id, name: `Org ${id}`, description: undefined, website: undefined, contactEmail: undefined, role: 'Organizer', createdAt: '2026-08-01T00:00:00Z' } as unknown as MyOrganizationResponse;
}

function setup(items: MyOrganizationResponse[] = [membership('org-1')]) {
  const organizationsAll = vi.fn(() => of(items));
  const client = { organizationsAll } as unknown as Client;
  const injector = Injector.create({ providers: [
    { provide: Client, useValue: client },
    DeckArchetypeSettingsService,
    I18nService
  ] });
  const component = runInInjectionContext(injector, () => new OrganizerOrganizationsComponent());
  return { component, organizationsAll };
}

async function flush(times = 4): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

describe('OrganizerOrganizationsComponent', () => {
  it('every member can manage', async () => {
    const { component } = setup();
    await flush();

    // Ownership is gone: every membership is an Organizer, so the link is always the Manage label.
    expect(component.items().map((entry) => entry.role)).toEqual(['Organizer']);
    expect(source).toContain(`data-cy="manage-org-link">{{ i18n.t('org.manage') }}</a>`);
    expect(source).not.toContain(`'Owner'`);
    expect(source).not.toContain(`i18n.t('common.view')`);
  });

  it('links each membership at the organization detail route', async () => {
    const { component } = setup([membership('org-1'), membership('org-2')]);
    await flush();

    expect(component.items().map((entry) => entry.id)).toEqual(['org-1', 'org-2']);
    expect(source).toContain(`[routerLink]="['/organizations', org.id]"`);
  });
});
