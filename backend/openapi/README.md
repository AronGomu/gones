# API contract workflow

API owns contract. Change producer first:

1. Add or update API endpoint integration test.
2. Implement endpoint and verify `dotnet test backend/Gones.sln --configuration Release`.
3. Run `npm run api:generate` from repository root.
4. Review `backend/openapi/gones.json` and generated `src/app/api/generated/gones-api.ts`.
5. Add or update handwritten adapter tests.
6. Run `npm run api:check`, `npm run typecheck`, and `npm test`.

`api:check` starts API in Development, normalizes server URL/newlines, regenerates with pinned local NSwag tool, then fails on drift. Never edit generated client directly.
