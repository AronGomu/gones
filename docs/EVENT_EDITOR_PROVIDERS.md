# Event editor provider setup

Event locations use manual worldwide address fields plus backend-validated IANA timezones. They need no external provider, billing account, API key, geocoding service, or operator setup.

Never place storage credential values in Git, Compose YAML, docs, logs, or support output.

## Private S3-compatible image storage setup

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
GONES_EVENT_IMAGES_S3_ENDPOINT=
GONES_EVENT_IMAGES_S3_BUCKET=
GONES_EVENT_IMAGES_S3_REGION=
GONES_EVENT_IMAGES_S3_ACCESS_KEY_FILE=
GONES_EVENT_IMAGES_S3_SECRET_KEY_FILE=
```

## Local MinIO

`docker compose up` starts private MinIO without publishing object port to host. `event-image-secret-init` generates credentials into private `event-image-secrets` volume. `event-image-bucket-bootstrap` creates `gones-event-images` idempotently, removes anonymous access, then permits API + Worker startup. Object bytes persist in `event-image-data`.

Check local contract without contacting external services:

```bash
docker compose config --quiet
npm run test -- --run ops/compose-contract.test.ts
dotnet test backend/Gones.sln --configuration Release --filter "FullyQualifiedName~Configuration|FullyQualifiedName~EventProvider"
```
