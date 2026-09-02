# Event editor provider setup

Complete provider-owned setup before enabling Event location or img flows. Never place key values in Git, Compose YAML, docs, logs, or support output.

## Google setup

1. Use billing-enabled Google Cloud project.
2. Enable Places API, Place Details API, and Time Zone API.
3. Create server key, not browser key.
4. Restrict key to those three APIs. Restrict requests to deployment egress IPs where provider supports it.
5. Inject key through `GONES_GOOGLE_MAPS_API_KEY_FILE` where host can mount secret file. `GONES_GOOGLE_MAPS_API_KEY` remains supported for hosts limited to env injection. File wins when both are present.
6. Restart API + Worker, then inspect readiness/log output. Output identifies provider state without printing key.

Missing Google config is allowed: API still starts, existing Event browsing stays available, location operations return RFC 7807 `503` with `location_provider_unavailable`.

## Private S3-compatible storage setup

For every non-local env:

1. Provision private S3 bucket. Disable public access at bucket/account layer.
2. Grant runtime identity only object read/write/delete plus bucket-list access needed by readiness.
3. Set absolute HTTP(S) service URI in `GONES_EVENT_IMAGES_S3_ENDPOINT`.
4. Set bucket in `GONES_EVENT_IMAGES_S3_BUCKET`, region in `GONES_EVENT_IMAGES_S3_REGION`.
5. Mount access ID at absolute path named by `GONES_EVENT_IMAGES_S3_ACCESS_KEY_FILE`.
6. Mount secret at absolute path named by `GONES_EVENT_IMAGES_S3_SECRET_KEY_FILE`.
7. Verify `/health/ready`. Missing/unreachable bucket reports `image_storage_unavailable` without credential values.

Required runtime keys:

```text
GONES_GOOGLE_MAPS_API_KEY=
GONES_GOOGLE_MAPS_API_KEY_FILE=
GONES_EVENT_IMAGES_S3_ENDPOINT=
GONES_EVENT_IMAGES_S3_BUCKET=
GONES_EVENT_IMAGES_S3_REGION=
GONES_EVENT_IMAGES_S3_ACCESS_KEY_FILE=
GONES_EVENT_IMAGES_S3_SECRET_KEY_FILE=
```

## Local MinIO

`docker compose up` starts private MinIO without publishing object port to host. `event-image-secret-init` generates credentials into private `event-image-secrets` volume. `event-image-bucket-bootstrap` creates `gones-event-images` idempotently, removes anonymous access, then permits API + Worker startup. Object bytes persist in `event-image-data`.

Check local contract without contacting Google or external S3:

```bash
docker compose config --quiet
npm run test -- --run ops/compose-contract.test.ts
dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~Configuration|FullyQualifiedName~EventProvider"
```
