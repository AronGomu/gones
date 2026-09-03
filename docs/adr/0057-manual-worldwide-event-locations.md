# ADR-0057: Manual worldwide Event locations

> Status: accepted; implemented
> Decided: 2026-09-03
> Owners: Event location editor, API, persistence
> Relates: ADR-0054 (direct publication and live preview)
> Supersedes: ADR-0051 (Google-resolved Event locations)

## Status

Accepted. Implemented in the Event API, persistence, generated client, and runtime contract.

## Context

ADR-0051 made Google Places and Time Zone APIs authoritative for Event locations. That design required billing, provider credentials, autocomplete sessions, signed 30-minute location tokens, attribution, retry policy, and persisted provider coordinates. Product owner will not pay for a location API and selected provider-free manual entry.

Events still need worldwide postal address text and an IANA timezone so local start time can convert safely to UTC across daylight-saving rules. Manual entry can validate completeness, length, and timezone identity, but cannot prove that address and timezone describe the same place.

## Decision

1. Event create/edit/proposal accepts required manual street address, postal code, city, region, country, and IANA timezone.
2. Backend NodaTime TZDB is timezone authority. A public catalog exposes sorted `DateTimeZoneProviders.Tzdb.Ids`; write paths validate against the same catalog.
3. Google Places/Time Zone calls, autocomplete/resolve endpoints, provider config, signed location tokens, provider place IDs, latitude, longitude, attribution, and outage retries retire.
4. Event persistence keeps normalized address text and `time_zone_id`; provider identity and coordinate columns are dropped. No sentinel or stale geodata remains.
5. Local start-time conversion, DST-gap rejection, public timezone display, viewer-zone conversion, and ICS output remain.
6. Country options use the bundled worldwide country asset. Existing country/timezone values absent from current catalogs remain visible during edit, but server validation decides whether a write is accepted.
7. Google OAuth remains unrelated and unchanged.

## Consequences

1. Event location entry has no paid API, provider credential, external request, provider outage, or provider retention policy.
2. Users type addresses and choose timezone manually. Typographic errors and address/timezone mismatch are possible and explicitly accepted.
3. Gones cannot provide provider-backed address verification, coordinates, proximity search, or map pins from canonical coordinates.
4. Address-based external map links may still search encoded address text, but are not canonical geodata.
5. Backend timezone catalog prevents browser/backend IANA-list drift.
6. Removing provider fields is a breaking API/DB change. Gones is unreleased, so no compatibility reader or sentinel backfill remains.

## Alternatives rejected

1. Paid Google APIs lost because product owner rejected paid location APIs.
2. Hosted free tiers lost because quotas and terms can change; they preserve external-provider continuity risk.
3. Public Nominatim lost because its public policy forbids client-side autocomplete.
4. Public Photon lost because demo infrastructure has no production availability guarantee.
5. Self-hosted Photon/Pelias lost because worldwide indexes impose meaningful infrastructure and operations cost.
6. Browser-only timezone lists lost because runtime/browser TZDB can drift from backend validation.
