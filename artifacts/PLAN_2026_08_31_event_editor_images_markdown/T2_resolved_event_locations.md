# T2: Resolved Event locations

**Plan:** `./artifacts/PLAN_2026_08_31_event_editor_images_markdown.md`
**Depends:** T1
**Commit outcome:** Event editor resolves worldwide Google suggestions into canonical visible address fields plus trusted 30-minute location token; edited/unresolved locations cannot publish.

## Context (self-contained)

- C1. Goal: derive Event IANA timezone automatically from worldwide location; no timezone input.
- C2. This slice: Google proxy endpoints, signed location token, canonical mapping, Angular autocomplete, debounce/invalidation/error UX.
- C3. Out of scope here: persisting location onto Event, direct publish, imgs, Markdown, final row layout.
- C4. Assumptions in force: street input triggers suggestions; all location fields stay editable; any edit clears resolution; unresolved blocks submit.

## Requirements

- R1. Add authenticated `GET /api/event-locations/autocomplete`; minimum-3-char behavior is client-side + server validates nonblank/bounded input.
- R2. Add authenticated `POST /api/event-locations/resolve`; call Place Details then Time Zone through T1 port.
- R3. Canonical Google mapping: `streetAddress` from street number + route; required `postalCode`; `city` from `locality`, fallback `postal_town`; `country`/`region` use `long_name`; all missing required components → `400 location_unresolved`.
- R4. Signed token includes user ID, Google `placeId`, canonical visible fields, lat/lon, IANA zone, issued/expiry; TTL exactly 30m; do not expose key. Validator returns all claims to Event writers.
- R5. Add frontend service/control: UUID billing session token per editing session; 300ms debounce; do not req below 3 chars; render max 5 suggestions.
- R6. Selection fills `country`, `region`, `streetAddress`, `postalCode`, `city`; any mutation of these clears `locationToken` + hidden resolved TZ/coords.
- R7. Field errors target `location.locationToken`; provider outage is retryable + preserves entered address.
- R8. Add endpoint OpenAPI + generated client in this ticket; keep repo green.

## Inputs

- I1. `src/app/features/events/organizer-event-create.component.ts:89-126` current raw address/timezone controls.
- I2. `src/app/features/events/organizer-event-create.ts:3-44` current flat draft/payload.
- I3. `src/app/shared/geo.service.ts` existing offline select data; do not use it as timezone authority.
- I4. `backend/src/Gones.Api/Events/EventPublicationEndpoints.cs:527-545` current Event payload.
- I5. **From Depends:** T1 contract copied below and in Interface contract; do not redesign.
- I6. T1 provides this binding contract:

```csharp
public interface IEventLocationProvider
{
    Task<IReadOnlyList<EventLocationSuggestion>> AutocompleteAsync(string input, string sessionToken, string language, CancellationToken cancellationToken);
    Task<ResolvedEventLocation> ResolveAsync(string placeId, string sessionToken, string language, CancellationToken cancellationToken);
}
public sealed record EventLocationSuggestion(string PlaceId, string PrimaryText, string SecondaryText);
public sealed record ResolvedEventLocation(
    string PlaceId, string StreetAddress, string PostalCode, string City,
    string Country, string Region, decimal Latitude, decimal Longitude, string TimeZoneId);
```

Config: `GONES_GOOGLE_MAPS_API_KEY|GONES_GOOGLE_MAPS_API_KEY_FILE`; missing config maps provider operation to RFC 7807 `503 location_provider_unavailable`; fake returns deterministic records.

## Interface contract (level 5)

- **Produces:**

```http
GET /api/event-locations/autocomplete?input={text}&sessionToken={uuid}&language={locale}
Authorization: Bearer <token>
```

```ts
interface EventLocationSuggestionResponse {
  placeId: string;
  primaryText: string;
  secondaryText: string;
}
interface EventLocationAutocompleteResponse {
  suggestions: EventLocationSuggestionResponse[]; // 0..5
}
```

```http
POST /api/event-locations/resolve
Content-Type: application/json
Authorization: Bearer <token>
```

```json
{"placeId":"google-place-id","sessionToken":"uuid","language":"en|fr"}
```

```ts
interface ResolvedEventLocationResponse {
  streetAddress: string;
  postalCode: string;
  city: string;
  country: string;
  region: string;
  latitude: number;
  longitude: number;
  timeZoneId: string; // valid IANA
  locationToken: string;
  expiresAt: string; // RFC 3339 Instant, issued+30m
}
```

```ts
interface EventLocationInput {
  streetAddress: string;
  postalCode: string;
  city: string;
  country: string;
  region: string;
  locationToken: string;
}
```

```csharp
public sealed record ValidatedEventLocation(
    string PlaceId,
    string StreetAddress,
    string PostalCode,
    string City,
    string Country,
    string Region,
    decimal Latitude,
    decimal Longitude,
    string TimeZoneId,
    Instant ExpiresAt);
public interface IEventLocationTokenService
{
    string Issue(Guid userId, ResolvedEventLocation location, Instant now);
    ValidatedEventLocation Validate(Guid userId, EventLocationInput input, Instant now);
}
```

- **Consumes:** T1 `IEventLocationProvider`; current authenticated Event-editor session.
- **Errors:** blank/oversize malformed req → `400` field error; no resolvable complete place → `400 location_unresolved`; bad signature/user/field hash → `400 location_token_invalid`; expiry → `400 location_token_expired`; Google unavailable → `503 location_provider_unavailable`.
- **Invariants:** token bound to authenticated user + Google place ID + exact five visible fields + coords/TZ; validator returns place ID/coords/TZ without provider call; field mutation clears token synchronously; no provider req under 3 chars; latest autocomplete req wins; max 5 rendered suggestions.
- **Integration links:** street input `organizer-event-create.component.ts` → Angular client → `/api/event-locations/*` → `IEventLocationProvider` → Google; resolve response → form fields/token → T5 publish validation → Event coords/TZ.

## TDD

1. **Red** — endpoint contract/token/provider tests + Angular debounce/selection/invalidation tests first.
2. **Green** — min API + client control.
3. **Refactor** — extract one location form adapter only if reused by create/edit.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| Debounce | `Pa`, then `Par` | no req for `Pa`; one req 300ms after `Par` |
| Canonical map | Google locality response | long names + locality + valid TZ/token |
| Postal-town fallback | no locality, postal_town set | city = postal_town |
| Missing component | no postal code | `400 location_unresolved` |
| Edit after select | mutate region | token/TZ/coords cleared; form unresolved |
| Token round-trip | issued place/fields/coords/TZ | validator returns exact place ID, fields, coords, TZ, expiry |
| Token expiry | issued+30m+epsilon | `400 location_token_expired` |
| User mismatch | token issued user A, validate user B | `400 location_token_invalid` |
| Provider outage | fake throws | `503 location_provider_unavailable`; input retained |

## Impl steps

- [ ] 1. Add failing backend location endpoint/token tests.
- [ ] 2. Add failing Angular service/form-state tests.
- [ ] 3. Implement proxy, canonical mapper, signer/validator.
- [ ] 4. Generate OpenAPI client + add Angular autocomplete/invalidation.
- [ ] 5. Add EN/FR labels/errors + `data-cy` on every rendered element.
- [ ] 6. Run scoped + full gates.

## Validation

- [ ] `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~EventLocation"`
- [ ] `npm run test -- --run src/app/features/events/organizer-event-create.component.test.ts`
- [ ] `npm run api:generate && npm run api:check`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] no silent-failure swallow on added path — `none`
- [ ] app functional — autocomplete resolves; editing any location field invalidates resolution; outage is visible/retryable
- [ ] commit msg draft: `feat(events): bind venue timezone to trusted resolved location`
