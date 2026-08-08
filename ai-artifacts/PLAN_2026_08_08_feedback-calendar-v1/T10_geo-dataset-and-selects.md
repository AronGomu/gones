# T10: Geo dataset + country/region/city selects

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T9
**Commit outcome:** The account page picks Country, Region and City from bundled offline datasets instead of typing free text.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket completes Profile §2: "Lieu" split into three `<select>` inputs fed by an existing public database.
- This slice: a build-time data generator, the runtime lookup service, and the three selects on the account form.
- Out of scope here: any backend change (T5 already stores the three columns), tournament venue fields, the delete-account button.
- Assumptions in force:
  - **A4** — data is bundled offline, generated from `country-region-data` (worldwide ISO-3166 countries) and `@etalab/decoupage-administratif` (French départements + communes). Country is worldwide; Region and City are populated for `FR` only; any other country falls back to free-text inputs for Region and City so no user is locked out.
  - Values stored are human-readable names, not codes, because T5's columns are `varchar(100)` and the public participant projection joins them into a display string. The département select stores its name (`"Rhône"`), the commune select its name (`"Lyon"`).

## Requirements

- `npm run geo:generate` writes `src/assets/geo/countries.json`, `src/assets/geo/fr-regions.json` and `src/assets/geo/fr-cities.json` from the dev dependencies; the generated files are committed.
- `GeoService` lazily fetches those files, caches them in memory, and exposes `countries()`, `regions(countryCode)` and `cities(countryCode, regionCode)`.
- The commune file is only fetched when the user selects `FR`, so the initial page load does not pay for it.
- The account form shows three `<select>` controls when the selected country has data, and plain `<input>` controls for Region/City otherwise.
- Changing the country resets Region and City; changing the Region resets City.
- A profile whose stored values are not in the dataset still renders them as the selected option rather than silently blanking them.
- Every element carries a unique `data-cy`.

## Inputs

- `package.json` — dev dependencies `country-region-data` and `@etalab/decoupage-administratif` were installed by T1; `scripts` already holds `db:seed`, `api:generate` etc. as `node scripts/*.mjs` entries.
- `country-region-data` exports an array of `{ countryName, countryShortCode, regions: [{ name, shortCode }] }`.
- `@etalab/decoupage-administratif` exposes `require('@etalab/decoupage-administratif/data/departements.json')` (objects with `code`, `nom`, `region`) and `.../data/communes.json` (objects with `code`, `nom`, `departement`, `type`). Filter communes to `type === 'commune-actuelle'`.
- `angular.json` — `src/assets` is already a declared asset folder; files under it are served at `assets/…` relative to the base href.
- `src/app/features/calendar/public-tournament.service.ts:51-65` — the existing pattern for fetching JSON with `HttpClient` and caching; follow its shape, but cache in memory only (these files are immutable build artifacts, the service worker already caches `assets/**`).
- **Test harness — there is no Angular `TestBed` and no zone.js in this repo.** `@angular/common/http/testing` is not
  installed and `node_modules/@angular/common` ships only `fesm2022`/`types`, so `HttpTestingController` and
  `provideHttpClientTesting()` are unavailable. Service tests build their own injector. Working example to copy,
  `src/app/features/calendar/public-tournament.service.test.ts:1-25`:
  ```ts
  import '@angular/compiler';
  import { HttpClient } from '@angular/common/http';
  import { Injector } from '@angular/core';
  import { of } from 'rxjs';
  import { vi } from 'vitest';

  const get = vi.fn().mockReturnValue(of(fixture));
  const injector = Injector.create({ providers: [GeoService, { provide: HttpClient, useValue: { get } }] });
  const service = injector.get(GeoService);
  ```
  Assert request counts and URLs through `get.mock.calls`. The same constraint applies to any component-level test:
  T9 added `src/app/features/settings/account-settings.component.test.ts`, which builds a bare `Injector` with
  `runInInjectionContext` and stubs `effect()` to a no-op because no `ChangeDetectionScheduler` is registered outside
  `bootstrapApplication`. Extend that file the same way rather than reaching for `TestBed`.
- `src/assets/` currently holds `brand/`, `config/` and image files — there is no `geo/` directory yet; create it.
- `ngsw-config.json:13-16` — the `assets` asset group already declares `"files": ["/assets/**"]`, which covers
  `.json`. Step 21 is therefore a confirmation, not an edit.
- `package.json:43,47` — `@etalab/decoupage-administratif ^6.0.0` and `country-region-data ^4.1.0` are already
  installed as dev dependencies by T1. Do **not** install anything.
- `ngsw-config.json` — asset groups already cover `assets/**`, so the files are available offline once installed. Confirm the glob covers `.json`; widen it if it does not.
- `src/app/features/settings/account-form.ts` — created by T9: `AccountFormValues` with `locationCountry`, `locationRegion`, `locationCity`; `accountFormValues(profile)`, `accountFormIsDirty(baseline, current)`, `accountFormPayload(values, currentPassword)`.
- `src/app/features/settings/account-settings.component.ts` — after T9 it binds each field with `[ngModel]="form().x"` / `(ngModelChange)="setField('x', $event)"`, has `readonly form` and `readonly baseline` signals, `isDirty()`, a warning-coloured submit gated by a confirm dialog, and a unique `data-cy` on every element. It is **not** in `PENDING_DATA_CY_RETROFIT`.
- `src/app/i18n/messages.ts` — `profile.locationCountry`, `profile.locationRegion`, `profile.locationCity` already exist in BOTH maps (added by T5).
- **From Depends (T9):** the form is signal-driven; adding fields means calling `setField(...)` and nothing else. The dirty computation compares whole `AccountFormValues` objects, so resetting Region/City on a country change automatically marks the form dirty.

## TDD

1. **Red** — write `src/app/shared/geo.service.test.ts` and `src/app/features/settings/location-selection.test.ts` against modules that do not exist.
2. **Green** — add the generator, run it, add the service and the selection helper, then rewire the template.
3. **Refactor** — none.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `generated countries are sorted and unique` | `src/assets/geo/countries.json` | ≥ 200 entries, each `{ code, name }`, sorted by `name`, no duplicate `code` |
| `generated FR regions match the départements count` | `src/assets/geo/fr-regions.json` | 101 entries, contains `{ code: '69', name: 'Rhône' }` |
| `generated FR cities are keyed by region` | `src/assets/geo/fr-cities.json` | object keyed by département code; `data['69']` contains `'Lyon'` |
| `service fetches each file once` | two `countries()` calls | one `HttpClient.get` |
| `cities are not fetched before FR is selected` | `countries()` then `regions('FR')` | no request for `fr-cities.json` |
| `unknown country yields no regions` | `regions('JP')` | `[]` |
| `country change clears region and city` | `applyCountry(values, 'BE')` | `locationRegion === ''` and `locationCity === ''` |
| `region change clears city` | `applyRegion(values, '01')` | `locationCity === ''` |
| `stored value survives an unknown option` | `optionsWithStoredValue(['Lyon'], 'Villeurbanne')` | `['Lyon', 'Villeurbanne']` |

Run: `npm run test -- geo.service location-selection geo-assets`

## Impl steps

- [ ] 1. Create `scripts/generate-geo.mjs`. It reads the two dev dependencies, writes the three JSON files into `src/assets/geo/`, and prints the entry count of each.
- [ ] 2. Countries: map `country-region-data` to `{ code: countryShortCode, name: countryName }`, sort by `name`, dedupe by `code`.
- [ ] 3. Regions: map `departements.json` to `{ code, name: nom }`, sort by `code`.
- [ ] 4. Cities: reduce `communes.json` filtered to `type === 'commune-actuelle'` into `Record<departementCode, string[]>`, each array sorted and deduped by name.
- [ ] 5. Add `"geo:generate": "node scripts/generate-geo.mjs"` to `package.json` `scripts`.
- [ ] 6. Run `npm run geo:generate` and commit the three generated files.
- [ ] 7. Add `src/assets/geo/geo-assets.test.ts`… actually place it at `src/app/shared/geo-assets.test.ts` so vitest picks it up: read the three files from disk and assert the first three Test plan rows.
- [ ] 8. Create `src/app/shared/geo.service.ts` with `export interface GeoOption { code: string; name: string; }` and `@Injectable({ providedIn: 'root' }) export class GeoService`.
- [ ] 9. In it, inject `HttpClient`, hold `private countriesCache?: Promise<GeoOption[]>`, `private regionsCache?: Promise<GeoOption[]>`, `private citiesCache?: Promise<Record<string, string[]>>`, each populated with `firstValueFrom(this.http.get(...))` on first call and reused thereafter.
- [ ] 10. `countries(): Promise<GeoOption[]>` fetches `assets/geo/countries.json`. `regions(countryCode: string): Promise<GeoOption[]>` returns `[]` unless `countryCode === 'FR'`, else fetches `assets/geo/fr-regions.json`. `cities(countryCode: string, regionCode: string): Promise<string[]>` returns `[]` unless `countryCode === 'FR'` and `regionCode` is non-empty, else fetches `assets/geo/fr-cities.json` and returns `data[regionCode] ?? []`.
- [ ] 11. Add `export function hasStructuredRegions(countryCode: string): boolean { return countryCode === 'FR'; }` to the same file so the template can switch between select and input.
- [ ] 12. Create `src/app/shared/geo.service.test.ts` with the fourth, fifth and sixth Test plan rows. **Do not use `HttpTestingController` or `TestBed`** — neither exists here (see Inputs). Follow the repo pattern from `src/app/features/calendar/public-tournament.service.test.ts`: `import '@angular/compiler';`, build the service with `Injector.create({ providers: [GeoService, { provide: HttpClient, useValue: { get } }] })` where `const get = vi.fn().mockReturnValue(of(fixture))`, then assert on `get.mock.calls` — `expect(get).toHaveBeenCalledTimes(1)` for the fetch-once row, and `expect(get.mock.calls.some(call => String(call[0]).includes('fr-cities.json'))).toBe(false)` for the lazy-load row.
- [ ] 13. Create `src/app/features/settings/location-selection.ts` with `applyCountry(values: AccountFormValues, code: string): AccountFormValues`, `applyRegion(values: AccountFormValues, code: string): AccountFormValues`, and `optionsWithStoredValue(options: string[], stored: string): string[]` (appends `stored` when non-empty and absent).
- [ ] 14. Create `src/app/features/settings/location-selection.test.ts` with the last three Test plan rows.
- [ ] 15. In `account-settings.component.ts`, inject `private readonly geo = inject(GeoService);` and add signals `readonly countryOptions = signal<GeoOption[]>([])`, `readonly regionOptions = signal<GeoOption[]>([])`, `readonly cityOptions = signal<string[]>([])`.
- [ ] 16. In the constructor, `void this.geo.countries().then(options => this.countryOptions.set(options));` and an `effect` that reloads `regionOptions` when `form().locationCountry` changes and `cityOptions` when `form().locationRegion` changes.
- [ ] 17. Replace the three location inputs with:
  ```
  <label for="account-location-country" data-cy="account-location-country-label">{{ i18n.t('profile.locationCountry') }}</label>
  <select id="account-location-country" data-cy="account-location-country" [ngModel]="form().locationCountry" (ngModelChange)="setCountry($event)" name="locationCountry">
    <option value="" data-cy="account-location-country-empty">—</option>
    @for (country of countryOptions(); track country.code) { <option [value]="country.name" [attr.data-cy]="'account-location-country-' + country.code">{{ country.name }}</option> }
  </select>
  ```
  and equivalents for Region and City, each wrapped in `@if (hasStructuredRegions(countryCodeOf(form().locationCountry))) { <select …> } @else { <input …> }`.
- [ ] 18. Add `setCountry(name: string)` and `setRegion(name: string)` methods on the component delegating to `applyCountry` / `applyRegion` and then `this.form.set(...)`.
- [ ] 19. Add `countryCodeOf(name: string): string` on the component, resolving a country **name** back to its ISO code through `countryOptions()`; store names but switch behaviour on the code.
- [ ] 20. Feed both selects through `optionsWithStoredValue(...)` so a stored value absent from the dataset is still selectable.
- [ ] 21. Confirm `ngsw-config.json`'s asset group glob includes `/assets/**` with `.json`; widen it if not, and note the change in the commit body.
- [ ] 22. Verify the file still passes `npm run test -- data-cy-coverage` (every new `option` needs `[attr.data-cy]`).
- [ ] 23. Update `cypress/e2e/auth-profile.cy.js`: select `France`, then `Rhône`, then `Lyon` via `cy.get('[data-cy=account-location-country]').select('France')` and assert the save button enables.
- [ ] 24. Run `npm run test && npm run lint && npm run typecheck && npm run build`.
- [ ] 25. Run `npm run dev` then `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js`.
- [ ] 26. Check the built bundle: `npm run build` output must not grow the initial chunk — the JSON files ship as assets, never imported into TypeScript. If any `import … from '*.json'` slipped in, remove it.

## Outputs

- Files created: `scripts/generate-geo.mjs`, `src/assets/geo/countries.json`, `src/assets/geo/fr-regions.json`, `src/assets/geo/fr-cities.json`, `src/app/shared/geo.service.ts`, `src/app/shared/geo.service.test.ts`, `src/app/shared/geo-assets.test.ts`, `src/app/features/settings/location-selection.ts`, `src/app/features/settings/location-selection.test.ts`.
- Files touched: `package.json`, `src/app/features/settings/account-settings.component.ts`, `cypress/e2e/auth-profile.cy.js`, possibly `ngsw-config.json`.
- Public API / behavior change: the account location fields are now constrained selects for France.
- Migrate / config: none; `npm run geo:generate` is a manual refresh step, documented in `src/AGENT.md`.

## Validation

- [ ] `npm run test` passes
- [ ] `npm run lint && npm run typecheck && npm run build` pass
- [ ] `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js` passes
- [ ] manual check: pick France → Rhône → Lyon, save, reload, all three still selected; pick Belgium and confirm Region/City fall back to text inputs
- [ ] manual check: DevTools Network shows `fr-cities.json` requested only after France is selected
- [ ] app functional — an account with a legacy free-text city still displays it
- [ ] commit msg draft: `feat(account): pick country, region and city from bundled offline datasets`
