# ADR-0051: Google-resolved Event locations

> Status: superseded
> Decided: 2026-08-31
> Owners: Calendar Event API and editor
> Relates: ADR-0035 (Event vocabulary), ADR-0039 (server-backed Event reads)
> Superseded by: ADR-0057 (manual worldwide Event locations)

## Status

Superseded by [ADR-0057](0057-manual-worldwide-event-locations.md). Provider-backed locations were implemented, then removed before release.

## Context

Event time is stored as venue-local date/time plus an IANA timezone. Today organizer enters `timeZoneId` manually, while country, region, street, postal code and city are unrelated free-text fields. A valid but wrong zone creates a valid UTC instant for the wrong venue; type validation cannot detect that error. Worldwide automatic timezone selection requires coordinates, and coordinates require a geocoding authority.

Gones serves a browser client, but a browser-held unrestricted Google key would expose billing capability. Publishing also must not trust client-supplied latitude, longitude or timezone. Calling Google again during Publish would make an otherwise validated form depend on provider availability at final commit time.

## Decision

1. Google Places Autocomplete, Place Details and Time Zone APIs are the worldwide location authority. Gones API proxies every provider request; Google credentials never enter the browser bundle.
2. `GET /api/event-locations/autocomplete` returns at most five suggestions. `POST /api/event-locations/resolve` returns canonical long-name address fields, coordinates, IANA timezone and a signed location token.
3. Token lifetime is 30 minutes. Token binds authenticated user, Google place ID, five visible address fields, coordinates, timezone and expiry.
4. Event create/edit sends visible location fields plus token. Server validates signature, user, expiry and exact field equality, then persists provider place identity, coordinates and timezone from token claims without another Google call.
5. Any visible location edit clears token immediately. Unresolved location cannot publish.
6. Missing Google config does not stop API startup or Event browsing. Location endpoints return RFC 7807 `503 location_provider_unavailable` until configured.

## Consequences

1. Google billing/account/API-key setup becomes operator-owned configuration.
2. Event publication no longer needs a visible timezone field, and cannot silently fall back to browser timezone.
3. Location token signing becomes security-sensitive code with expiry, user-binding and field-hash tests.
4. A 30-minute form pause requires location re-resolution before Publish. This friction is accepted to avoid indefinite reusable provider assertions.
5. Stored long names follow provider canonicalization. Future provider replacement needs explicit data/wire strategy; `placeId` is provider-specific.
6. Tests use a deterministic fake provider; CI never calls Google.

## Alternatives rejected

1. Browser-direct Google calls lost because credential/billing exposure moves outside Gones API controls.
2. Client-supplied coordinates/timezone lost because a caller could pair any address text with any zone.
3. Re-querying Google during Publish lost because provider outage would invalidate a previously resolved form at irreversible commit time.
4. Country/region-to-timezone lookup lost because many countries and regions span zones; street-level Event location cannot be proven from that mapping.
5. Browser timezone fallback lost because organizer timezone is not venue timezone.
