# Backend dependency ledger

Review date: 2026-07-24

| Package | Version | Purpose | License | Advisory result |
|---|---:|---|---|---|
| Microsoft.AspNetCore.OpenApi | 10.0.8 | OpenAPI document endpoint | MIT | No known advisory |
| Microsoft.OpenApi | 2.11.0 | Patched OpenAPI model (direct transitive pin) | MIT | No known advisory; older 2.0–2.3 releases rejected for GHSA-v5pm-xwqc-g5wc |
| Microsoft.EntityFrameworkCore | 10.0.4 | ORM kernel | MIT | No known advisory |
| Microsoft.EntityFrameworkCore.Design | 10.0.4 | Migration tooling | MIT | No known advisory |
| Microsoft.Extensions.Diagnostics.HealthChecks.EntityFrameworkCore | 10.0.4 | DB readiness | MIT | No known advisory |
| Npgsql.EntityFrameworkCore.PostgreSQL | 10.0.3 | PostgreSQL EF provider | PostgreSQL | No known advisory |
| Npgsql.EntityFrameworkCore.PostgreSQL.NodaTime | 10.0.3 | NodaTime PostgreSQL mapping | PostgreSQL | No known advisory |
| NodaTime | 3.2.2 | UTC/zone-safe time model | Apache-2.0 | No known advisory |
| NodaTime.Serialization.SystemTextJson | 1.3.0 | Strict NodaTime JSON contracts | Apache-2.0 | No known advisory |
| Testcontainers.PostgreSql | 4.8.1 | Real PostgreSQL integration tests | Apache-2.0 | No known advisory |

Evidence: `dotnet list backend/Gones.sln package --vulnerable --include-transitive` returned no vulnerable packages. Direct versions use central package management; committed `packages.lock.json` files pin transitive graphs. Production code has no Testcontainers dependency.
