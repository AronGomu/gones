# T1: Runtime and provider foundations

**Plan:** `./artifacts/PLAN_2026_08_31_event_editor_images_markdown.md`
**Depends:** none
**Commit outcome:** Local stack supplies private S3-compatible media storage, pinned renderer/media deps, provider ports/fakes, secret-file config, readiness, and setup docs without committing credentials.

## Context (self-contained)

- C1. Goal: enable resolved locations, Markdown, and Event imgs without coupling feature code to Google/S3 SDKs.
- C2. This slice: frontloads every user-owned provider action, package pin, local MinIO service, config contract, provider port, fake, readiness/error policy.
- C3. Out of scope here: location endpoints, img endpoints/DB, Markdown rendering, Event UI/payload changes.
- C4. Assumptions in force: API may start without Google key; location calls then return `503 location_provider_unavailable`. Local compose always starts MinIO. No secret enters Git.
- C5. Repo facts: API/worker containers are read-only (`compose.yaml:3-8`); compose has only `postgres-data` today (`compose.yaml:183-184`); packages are centrally pinned (`backend/Directory.Packages.props:1-5`).

## Requirements

- R1. Add `marked@18.0.11` to `dependencies` in `package.json`/lock.
- R2. Add central NuGet versions: `Markdig` `1.3.2`, `SixLabors.ImageSharp` `4.1.1`, `AWSSDK.S3` `4.0.102.4`; reference only from projects that consume them.
- R3. Add private MinIO + idempotent bucket-bootstrap services to `compose.yaml`; bucket name `gones-event-images`; persist in named volume `event-image-data`; no host-public object endpoint.
- R4. Add Google config: `GONES_GOOGLE_MAPS_API_KEY`, `GONES_GOOGLE_MAPS_API_KEY_FILE`. File wins when both set, matching `AddGonesSecretFiles` conventions.
- R5. Add S3 config: `GONES_EVENT_IMAGES_S3_ENDPOINT`, `GONES_EVENT_IMAGES_S3_BUCKET`, `GONES_EVENT_IMAGES_S3_REGION`, `GONES_EVENT_IMAGES_S3_ACCESS_KEY_FILE`, `GONES_EVENT_IMAGES_S3_SECRET_KEY_FILE`.
- R6. Frontload human setup in `docs/EVENT_EDITOR_PROVIDERS.md`: enable Google Places API, Place Details API, Time Zone API; create billing-enabled server key; restrict key to those APIs + deployment egress where provider supports it; place secret via env/file; provision private S3 bucket for non-local env. Never include key values.
- R7. Add deterministic fake Google + in-memory object-store impls for unit/integration tests. Tests never call external Google/S3.
- R8. Add readiness checks for configured S3 bucket. Missing Google key does not fail startup. Configured but unreachable S3 fails media readiness with no secret in output.
- R9. Add shared RFC 7807 exception mapping/catalog for `location_provider_unavailable` + `image_storage_unavailable`; feature tickets own endpoint-specific tests.
- R10. Add EN/FR operator-facing error keys only when rendered in frontend; no speculative UI here.

## Inputs

- I1. `package.json`, `package-lock.json`.
- I2. `backend/Directory.Packages.props`.
- I3. `backend/src/Gones.Api/Gones.Api.csproj`, `backend/src/Gones.Infrastructure/Gones.Infrastructure.csproj`, `backend/src/Gones.Worker/Gones.Worker.csproj`.
- I4. `backend/src/Gones.Api/Program.cs:34-42,130-146` config/HTTP-client composition.
- I5. `backend/src/Gones.Worker/Program.cs:13-40` worker config/persistence composition.
- I6. `compose.yaml`, `.env.example`, `deploy/`, `ops/` runtime tests.
- I7. **From Depends:** none.

## Interface contract (level 5)

- **Produces:**

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

public interface IEventImageObjectStore
{
    Task PutAsync(string key, Stream content, string contentType, CancellationToken cancellationToken);
    Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken);
    Task DeleteAsync(string key, CancellationToken cancellationToken);
}
public interface IEventImageProcessor
{
    Task<ProcessedEventImage> ProcessAsync(Stream source, string contentType, CancellationToken cancellationToken);
}
public sealed record ProcessedEventImage(int Width, int Height, IReadOnlyList<ProcessedEventImageVariant> Variants);
public sealed record ProcessedEventImageVariant(int Width, int Height, ReadOnlyMemory<byte> WebP);
```

```text
GONES_GOOGLE_MAPS_API_KEY=<secret, optional>
GONES_GOOGLE_MAPS_API_KEY_FILE=<absolute secret-file path, optional>
GONES_EVENT_IMAGES_S3_ENDPOINT=<absolute http(s) URI>
GONES_EVENT_IMAGES_S3_BUCKET=<bucket name; local default gones-event-images>
GONES_EVENT_IMAGES_S3_REGION=<S3 region; local default us-east-1>
GONES_EVENT_IMAGES_S3_ACCESS_KEY_FILE=<absolute secret-file path>
GONES_EVENT_IMAGES_S3_SECRET_KEY_FILE=<absolute secret-file path>
```

- **Consumes:** `IConfiguration`; S3-compatible API; Google web APIs only through `IEventLocationProvider` impl.
- **Errors:** provider call unavailable → RFC 7807 `503`, code `location_provider_unavailable`; object-store call unavailable → RFC 7807 `503`, code `image_storage_unavailable`. Startup/readiness text must not echo secrets.
- **Invariants:** fake providers deterministic; API can browse Events without Google config; local MinIO private; S3 bucket exists before API readiness passes; secret values never logged.
- **Integration links:** config `Program.cs` → provider registration → T2/T3 injected ports → Google/S3; compose MinIO → bucket bootstrap → API/worker readiness.

## TDD

1. **Red** — add config/secret precedence, missing-Google, S3 readiness, fake-provider, compose-contract tests; prove failure before impl.
2. **Green** — pin deps, add ports/config/providers/MinIO/docs until tests pass.
3. **Refactor** — dedupe config loading only if green; keep ports feature-specific.

## Test plan

| Test | Input | Expect |
| ---- | ----- | ------ |
| Google file secret precedence | env + file | file value used; neither value logged |
| Missing Google | no key/file | API starts; provider operation maps `503 location_provider_unavailable` |
| S3 readiness | configured unreachable endpoint | readiness unhealthy; `image_storage_unavailable`; no secret output |
| Local object store | `docker compose config` | MinIO, bucket bootstrap, private named volume present |
| Fake providers | fixed req | deterministic suggestion/location/object bytes |
| Dependency pins | package manifests | exact versions from R1-R2 |

## Impl steps

- [ ] 1. Write failing runtime/config tests.
  - [ ] 1.1 Assert env/file precedence + no-secret diagnostics.
  - [ ] 1.2 Assert missing Google is nonfatal + operation unavailable.
  - [ ] 1.3 Assert S3 readiness + compose MinIO/bucket/volume.
- [ ] 2. Pin frontend/NuGet deps + regenerate locks.
- [ ] 3. Add ports, Google/S3 impl shells, deterministic fakes, config loaders.
- [ ] 4. Add MinIO + bucket bootstrap + worker/API env wiring.
- [ ] 5. Write `docs/EVENT_EDITOR_PROVIDERS.md` with all user-owned setup first.
- [ ] 6. Run scoped + full validation.

## Validation

- [ ] `npm run test -- --run ops/runtime-config.test.ts`
- [ ] `npm run test -- --run ops/compose-contract.test.ts`
- [ ] `dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~Configuration|FullyQualifiedName~EventProvider"`
- [ ] `docker compose config --quiet`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] no silent-failure swallow on added path — list each kept site + why, or `none`
- [ ] app functional — API browsing remains available without Google key; MinIO readiness passes locally
- [ ] commit msg draft: `feat(events): establish private provider boundaries before editor integration`
