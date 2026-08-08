# Structured Profile Location and Birth Date

## Status

Accepted. Amends the user profile contract introduced with local identity.

## Context

The profile stored `location` as one free-text string and `birth_year` as an integer. The product
owner asked for the location to become three constrained selects — country, region at French
*département* granularity, city — sourced from an existing public database, and for the birth year to
become a date input.

Free text cannot be filtered, grouped or matched. Three constrained fields can. And a date input that
silently discards the day and month it collected is a lie told to the user.

The data source question had three answers: call `geo.api.gouv.fr` at runtime, import the dataset into
Postgres and serve it, or bundle it as static assets. Runtime calls add a third-party origin to the
CSP and break offline — this is an installable PWA. A server-side table adds migrations, endpoints and
a seed pipeline for data that changes once a year.

## Decision

**Three columns, a real date, and a bundled dataset.**

- `location` becomes `location_country`, `location_region`, `location_city`, each `varchar(100)`.
  Existing values backfill into `location_city`. One privacy toggle, `is_location_public`, still
  governs all three; the public projection joins them for display.
- `birth_year int` becomes `birth_date date`, backfilled to `YYYY-01-01`. `IsBirthYearPublic` becomes
  `IsBirthDatePublic`. **The public participant projection still exposes only the year**, computed
  from the date — the precision is stored, not published.
- `npm run geo:generate` builds `src/assets/geo/countries.json`, `fr-regions.json` and
  `fr-cities.json` at development time from `country-region-data` (worldwide ISO-3166) and
  `@etalab/decoupage-administratif` (French départements and communes). The generated files are
  committed.
- The communes file is fetched only after France is selected, so the initial load does not pay for
  35 000 rows.
- **Names are stored, not codes.** The columns are display strings feeding a public projection; a
  code would need a lookup on every read for no gain.
- Country is worldwide; region and city selects are populated for `FR` only. Any other country falls
  back to free-text region and city inputs, so no user outside France is locked out.
- A stored value absent from the dataset is still rendered as the selected option. A pre-existing
  free-text city is never silently blanked.

## Consequences

- One EF migration covers both changes; the API contract and the generated client change together.
- The geo assets add roughly a megabyte to the deployed asset set and nothing to the initial JavaScript
  bundle — they are fetched as data, never imported as modules. `ngsw-config.json` already caches
  `assets/**`, so they work offline once installed.
- The dataset is a snapshot. Refreshing it is a manual `npm run geo:generate` and a commit; commune
  lists change slowly enough that this is the right trade.
- `PatchUserProfileRequest` and `UserProfileResponse` are breaking for any external consumer. There
  is none.
