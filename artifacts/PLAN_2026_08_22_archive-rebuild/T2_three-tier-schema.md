# T2: Three-tier archive schema and domain aggregates

> ## ⚠ ARBITRATION OVERRIDE — read before the body; these win over anything below
>
> **A. The three entity classes are `Archive`-prefixed. Rename them throughout this ticket.**
> The body declares `class League`, `class LeagueSeason` and `class Tournament` in namespace
> `Gones.Domain.Archive`. **Every consuming ticket — T5, T6, T7 — was written against the prefixed
> names**, and a bare `League` collides conceptually with
> `Gones.Domain.Leagues.LeagueArchiveAggregate` (alive until T19) while a bare `Tournament` collides
> with the Live tournament. Binding:
>
> ```csharp
> namespace Gones.Domain.Archive;
> public sealed class ArchiveLeague        // NOT League
> public sealed class ArchiveLeagueSeason  // NOT LeagueSeason
> public sealed class ArchiveTournament    // NOT Tournament
> ```
>
> Document records are prefixed to match: `ArchiveLeagueDocument`, `ArchiveLeagueSeasonDocument`
> (the body calls it `LeagueSeasonDocument`), `ArchiveTournamentDocument`. DbSets are
> `GonesDbContext.ArchiveLeagues`, `.ArchiveLeagueSeasons`, `.ArchiveTournaments` — the body already
> has these right.
>
> **Deliberate asymmetry:** the *TypeScript* module keeps the unprefixed `LeagueSeasonDocument`,
> because it lives in its own module where nothing collides. C# prefixed, TypeScript not.
>
> **B. `Version` is `int` and rows do not derive `VersionedEntity`.** The body already decided this
> correctly — confirming it, because `GonesDbContext.IncrementVersions` only auto-bumps that base
> class. **Load-bearing consequence:** every archive row write must increment `version` explicitly,
> including a counter-only recomputation. On the wire `documentVersion` is an `int`, never a `long`.
>
> **C. The `MigrationSafetyTests` sentinel the body flags as unresolved is handled by T1.** T1 swaps
> `renameMigrations > 0` for a `scanned > 0` sentinel, because post-squash there is legitimately no
> `RenameTable` migration left. Nothing to do here.

**Plan:** `./artifacts/PLAN_2026_08_22_archive-rebuild.md`
**Depends:** T1
**Commit outcome:** Three tables plus their domain aggregates and the derived lock rule exist; the legacy archive surface still serves.

## Context (self-contained)

- **Goal:** rebuild the Gones Archive on three tiers — **League → LeagueSeason → Tournament**. A Tournament becomes a first-class top-level record that may stand alone (`seasonId: null`). Today's flat `League` becomes `LeagueSeason`; a new `League` tier groups Seasons.
- **This slice:** the backend foundation. It adds the C# domain aggregates, the derived lock rule, the EF mapping, the DbSets and **exactly one** migration creating the three new tables. Nothing reads or writes them yet — the endpoints arrive in later tickets. This slice is pure persistence + domain shape.
- **Out of scope here (hard fence — do not cross):**
  - **NO HTTP endpoints.** Do not add, edit or register a route. Do not touch `backend/src/Gones.Api/**`.
  - **NO frontend.** Do not touch `src/**`, `cypress/**`, `fixtures/**`, `ops/**`, `scripts/**`.
  - **Do not delete or modify** `backend/src/Gones.Domain/Leagues/LeagueArchiveAggregate.cs`, `backend/src/Gones.Api/Leagues/PublicLeagueEndpoints.cs`, `backend/src/Gones.Api/Leagues/LeagueCommandEndpoints.cs`, `backend/src/Gones.Infrastructure/Persistence/LeagueArchiveAggregateConfiguration.cs`, or the existing `league_archive_aggregates` table. The legacy archive surface must keep compiling and serving after this commit; a later ticket removes it.
  - **Do not touch `player_statistics`**, `backend/src/Gones.Infrastructure/Persistence/PlayerStatisticsReadModel.cs`, `PlayerStatisticsReadModelConfigurations.cs`, `PlayerStatisticsFormula.cs`, or `PlayerStatisticsRebuildService`. Scoped statistics are a different ticket.
  - **Do not add a hosted service / backfill** for the new `counts_version` columns.
  - **Do not add an ADR**, do not edit `AGENT.md`, `docs/**` or `README.md`.
  - Exactly **one** new migration, named exactly `RebuildArchiveThreeTier`. Not two. Not a differently-named one.
- **Assumptions in force:**
  1. **Gones is unreleased. There is no production environment and there are no users.** Local data may be reset freely. There is therefore no data migration and no backfill of existing rows into the new tables — the three tables are created empty and stay empty until later tickets fill them.
  2. T1 has already run. When you start, `backend/src/Gones.Infrastructure/Persistence/Migrations/` contains exactly one migration named `InitialCreate` (plus its `.Designer.cs` and `GonesDbContextModelSnapshot.cs`). Your migration is the second one in that directory.
  3. The repo uses **NodaTime** (`NodaTime` 3.2.2) throughout the backend. `Instant` for timestamps, `LocalDate` for calendar dates. Npgsql is configured with `npgsql.UseNodaTime()` in `backend/src/Gones.Infrastructure/Persistence/GonesDbContextOptions.cs`, so `Instant → timestamptz` and `LocalDate → date` are the default mappings. Do not use `DateTime` or `DateTimeOffset`.
  4. `backend/Directory.Build.props` sets `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>` and `<Nullable>enable</Nullable>`. Any warning fails the build.
  5. `backend/src/Gones.Domain/Gones.Domain.csproj` references **only** `NodaTime`. The new namespace lives in that project and may use `Gones.Domain.Leagues` types, nothing else.
  6. **Known pre-existing red, not yours to fix:** `backend/tests/Gones.ArchitectureTests/MigrationSafetyTests.cs` contains `Rename_migrations_never_drop_or_recreate_the_table_they_rename`, which asserts `renameMigrations > 0` — "No committed migration renames a table; this guard is scanning nothing." Once T1 collapsed 71 migrations into a single `InitialCreate`, no committed migration contains `migrationBuilder.RenameTable`, so that test fails for a reason this slice neither causes nor is allowed to fix (the fence forbids touching that surface). If you see exactly that failure, record it and move on. **Any other** failure in `MigrationSafetyTests` — in particular `Committed_migrations_fully_describe_the_model` — is yours.

## Requirements

1. A new C# namespace `Gones.Domain.Archive` exists in `backend/src/Gones.Domain/Archive/`, holding three aggregates — `League`, `LeagueSeason`, `Tournament` — and their supporting document records.
2. `ArchiveLockRule` exists in that namespace and mirrors the frontend lock rule exactly: a Tournament locks **more than 365 whole calendar days** after the day it was played. 365 days old is **not** locked; 366 days old **is**.
3. Three PostgreSQL tables exist — `archive_leagues`, `archive_league_seasons`, `archive_tournaments` — with exactly the columns, types, nullability, primary keys, foreign keys and named indexes given in *Interface contract → Produces → SQL*.
4. `GonesDbContext` exposes one `DbSet` per aggregate.
5. `LeagueSeason` carries denormalized counters `TournamentCount`, `PlayerCount`, `FirstTournamentDate`, `LastTournamentDate`, `CountsVersion`. `Tournament` carries `PlayerCount`, `CountsVersion`. Both are computed by one shared pure function pair, versioned by one shared constant, so a formula change is one bump.
6. **The player count uses the Swiss-standings row count the repo already computes** — `LeagueRules.CalculateTournamentResult(...).Rows.Count` for one Tournament, `LeagueRules.CalculateLeagueResult(...).Rows.Count` for a Season. Not a name scan, not a `DISTINCT` in SQL. This is the number the browser prints, and two derivations that can drift is the bug this requirement prevents.
7. Concurrency is **per row**. Each aggregate owns an `int Version` starting at `1`, mapped as an EF concurrency token, bumped by its own mutators. Refreshing a Season's counters after a Tournament write must **not** bump the Season's `Version` or `UpdatedAt`.
8. Exactly one migration named `RebuildArchiveThreeTier`, and `GonesDbContextModelSnapshot.cs` updated by the same scaffold run.
9. Pure domain unit tests in `backend/tests/Gones.UnitTests/` cover the lock rule, the counts, and every aggregate mutator.
10. `npm run backend:build` and `npm run backend:test` pass (modulo assumption 6 above). The legacy `/api/leagues-archive/**` surface is untouched and still compiles.

## Inputs

Files to read before writing code (paths are repo-relative to `/home/aron/projects/gones`):

- `backend/src/Gones.Domain/Leagues/LeagueArchiveAggregate.cs` — the aggregate idiom to mirror: `required` init-only `DocumentId`, `private set` mutable state, static `Create`, instance `Apply`, `SoftDelete`, `RefreshCatalogCounts`, `ReadDocument`, private `SerializeBounded` / `ValidateDocument` / `ValidateString`, `public const int Maximum*` limits, `ArgumentException` with a literal message.
- `backend/src/Gones.Domain/Leagues/LeagueCatalogCounts.cs` — 19 lines. The counts idiom: `public const int Version = 1;` plus a static `From`. Its body is `(document.Tournaments.Count, LeagueRules.CalculateLeagueResult(document).Rows.Count)`.
- `backend/src/Gones.Domain/Leagues/LeagueDocuments.cs` — `LeagueDocument`, `TournamentDocument`, `RoundDocument`, `RoundEntry`, `MatchRoundEntry`, `ByeRoundEntry`, `InvalidRoundEntry`, `PlayerArchetypeDocument`, `LeagueResult`, `TournamentResult`. Reused, never duplicated.
- `backend/src/Gones.Domain/Leagues/LeagueJson.cs` — `LeagueJson.Serialize<T>` / `Deserialize<T>` / `Options`. Web defaults, camelCase, `DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull`, `WriteIndented = false`.
- `backend/src/Gones.Domain/Leagues/LeagueRules.cs:96-119` — `CalculateTournamentResult(TournamentDocument)` and `CalculateLeagueResult(LeagueDocument)`, the Swiss standings passes.
- `backend/src/Gones.Infrastructure/Persistence/LeagueArchiveAggregateConfiguration.cs` — the EF configuration idiom: `builder.ToTable("…")`, `HasColumnType("jsonb")`, `HasIndex`, and `builder.ToTable(table => table.HasCheckConstraint("ck_…", "…"))`.
- `backend/src/Gones.Infrastructure/Persistence/PlayerStatisticsReadModelConfigurations.cs:10-20` — the precedent for a non-`VersionedEntity` entity with a `text` primary key and an explicit `HasColumnType("text")`.
- `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs` — where the DbSets go, and the two loops that only ever touch `Gones.Domain.Persistence.VersionedEntity` subclasses.
- `backend/src/Gones.Infrastructure/Persistence/SnakeCaseModelBuilderExtensions.cs` — `UseSnakeCaseNames()` runs last in `OnModelCreating` and snake-cases table names, column names, key names, FK constraint names and index database names.
- `backend/tests/Gones.UnitTests/LeagueCatalogCountsTests.cs` — the unit test idiom to mirror: `public sealed class …Tests`, `[Fact]`, `private static readonly Instant Now = Instant.FromUtc(…)`, private static builder helpers at the bottom.
- `backend/tests/Gones.UnitTests/LeagueArchiveAggregateReadTests.cs:76-114` — the `Allocated(Action)` helper and the "a read must not recompute the standings" test, both reused verbatim below.
- `backend/src/Gones.Infrastructure/Persistence/Migrations/20260820113606_AddLeagueArchiveCatalogCounts.cs` — the migration file shape (`#nullable disable`, `namespace Gones.Infrastructure.Persistence.Migrations`, `/// <inheritdoc />`).

**From Depends (T1) — spell out, do not go read T1:**

- `backend/src/Gones.Infrastructure/Persistence/Migrations/` contains exactly one migration class, `InitialCreate`, describing the whole current schema (identity, organizations, events, notifications, catalog, live, `league_archive_aggregates`, `player_statistics`, `player_statistics_meta`, shared records), plus `GonesDbContextModelSnapshot.cs` matching it.
- The archive tables are **empty**. T1 wiped local data. Nothing you write needs to preserve a row.
- `GonesDbContext` is otherwise unchanged from what is described in *Inputs*: the same DbSet list, the same `OnModelCreating` ending in `modelBuilder.UseSnakeCaseNames()`.
- The EF tool is a local, gitignored install at `backend/.tmp-tools/dotnet-ef` (dotnet-ef 10.0.4). If it is missing, reinstall it with the command in *Impl steps 7.1*.

## Interface contract (level 5)

### Produces — C# domain, namespace `Gones.Domain.Archive`

All of the following live under `backend/src/Gones.Domain/Archive/`.

**`ArchiveDocuments.cs`**

```csharp
using Gones.Domain.Leagues;

namespace Gones.Domain.Archive;

/// <summary>Top tier. Groups Seasons. Carries no Tournaments — they are fetched as their own rows.</summary>
public sealed record ArchiveLeagueDocument(string Id, string Name, string CreatedAt);

/// <summary>Middle tier. Mandatory parent League. What used to be called a League.</summary>
public sealed record LeagueSeasonDocument(string Id, string Name, string LeagueId, string Status);

/// <summary>
/// Bottom tier, now top-level: every Tournament is its own row. <c>SeasonId</c> is <c>null</c> for a
/// standalone Tournament. There is deliberately no League ID — the League is derived by joining
/// through <c>SeasonId</c>.
/// </summary>
public sealed record ArchiveTournamentDocument(
    string Id,
    string Name,
    string? SeasonId,
    string TournamentDate,
    string Status,
    IReadOnlyList<RoundDocument> Rounds,
    IReadOnlyList<PlayerArchetypeDocument> PlayerArchetypes);

internal static class ArchiveValidation
{
    public static void ValidateString(string? value, string field, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > maximumLength)
            throw new ArgumentException($"{field} must contain 1 to {maximumLength} characters.", field);
    }

    public static void ValidateStatus(string? status, string subject)
    {
        if (status is not ("active" or "completed"))
            throw new ArgumentException($"{subject} status must be active or completed.", "status");
    }

    /// <summary>Null, empty and whitespace all mean "standalone"; everything else is validated as an ID.</summary>
    public static string? NormalizeSeasonId(string? seasonId, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(seasonId)) return null;
        ValidateString(seasonId, "seasonId", maximumLength);
        return seasonId;
    }
}
```

- `ArchiveTournamentDocument.TournamentDate` is an **ISO 8601 calendar date string, `YYYY-MM-DD`** — a string and not a `LocalDate` because this record is serialized by `LeagueJson`, which registers no NodaTime converters. Field order matches the frontend `ArchiveTournamentDocument` interface exactly.
- `ArchiveLeagueDocument.CreatedAt` is an ISO 8601 UTC instant string. It is the export/wire shape only; the aggregate stores an `Instant`.

**`ArchiveLockRule.cs`**

```csharp
using NodaTime;

namespace Gones.Domain.Archive;

/// <summary>
/// A Tournament locks 365 days after the day it was played. Derived, never stored: a row cached today
/// as unlocked would otherwise become locked without a refetch. The browser mirrors this rule in
/// <c>isArchiveTournamentLocked</c>, so the two must agree day for day.
/// </summary>
public static class ArchiveLockRule
{
    public const int LockWindowDays = 365;

    /// <summary>
    /// <c>locked ⇔ (today - tournamentDate) &gt; 365</c>, counted in whole calendar days. Exactly 365
    /// days old is not locked; 366 days old is. A future date is never locked.
    /// </summary>
    public static bool IsLocked(LocalDate tournamentDate, LocalDate today) =>
        Period.Between(tournamentDate, today, PeriodUnits.Days).Days > LockWindowDays;
}
```

**`ArchiveCatalogCounts.cs`**

```csharp
using Gones.Domain.Leagues;
using NodaTime;
using NodaTime.Text;

namespace Gones.Domain.Archive;

/// <summary>The four numbers a League Season row prints, denormalized onto the aggregate.</summary>
public sealed record ArchiveSeasonCounts(
    int TournamentCount,
    int PlayerCount,
    LocalDate? FirstTournamentDate,
    LocalDate? LastTournamentDate);

/// <summary>The one number a Tournament row prints, denormalized onto the aggregate.</summary>
public sealed record ArchiveTournamentCounts(int PlayerCount);

/// <summary>
/// The denormalized archive catalog counts, so a catalog query never deserializes a document.
///
/// <para>Both player counts are the Swiss standings row count — the same number the browser prints —
/// and not a name scan, so the two stacks cannot disagree. Bump <see cref="Version"/> in the same
/// commit as any change to how any of these numbers is derived: a stored <c>counts_version</c> of
/// <c>0</c> means "never computed", which is what makes a stored <c>0</c> count unambiguous.</para>
/// </summary>
public static class ArchiveCatalogCounts
{
    public const int Version = 1;

    public static ArchiveTournamentCounts ForTournament(ArchiveTournamentDocument tournament);

    /// <param name="seasonId">Stamped onto the synthetic League so the standings input is self-consistent.</param>
    public static ArchiveSeasonCounts ForSeason(string seasonId, IReadOnlyList<ArchiveTournamentDocument> tournaments);
}
```

Bodies, binding — these are the exact calls:

```csharp
public static ArchiveTournamentCounts ForTournament(ArchiveTournamentDocument tournament)
{
    ArgumentNullException.ThrowIfNull(tournament);
    var legacy = ArchiveDocumentAdapter.ToLegacyTournament(tournament, tournament.SeasonId ?? string.Empty);
    return new ArchiveTournamentCounts(LeagueRules.CalculateTournamentResult(legacy).Rows.Count);
}

public static ArchiveSeasonCounts ForSeason(string seasonId, IReadOnlyList<ArchiveTournamentDocument> tournaments)
{
    ArgumentNullException.ThrowIfNull(tournaments);
    // CalculateLeagueResult reads only Tournaments; Name and Status are inert placeholders. It also
    // hands back the min and max Tournament date, which is exactly the pair the Season row prints.
    var league = new LeagueDocument(
        seasonId,
        seasonId,
        "completed",
        [.. tournaments.Select(tournament => ArchiveDocumentAdapter.ToLegacyTournament(tournament, seasonId))]);
    var result = LeagueRules.CalculateLeagueResult(league);
    return new ArchiveSeasonCounts(
        tournaments.Count,
        result.Rows.Count,
        ParseOrNull(result.StartDate),
        ParseOrNull(result.EndDate));
}

private static LocalDate? ParseOrNull(string value)
{
    if (value.Length == 0) return null;
    var parse = LocalDatePattern.Iso.Parse(value);
    return parse.Success ? parse.Value : null;
}
```

**`ArchiveDocumentAdapter.cs`**

```csharp
using Gones.Domain.Leagues;

namespace Gones.Domain.Archive;

/// <summary>
/// Bridges a three-tier Tournament onto the Swiss standings engine in <see cref="LeagueRules"/>, which
/// still speaks <see cref="TournamentDocument"/>. One conversion in one place, so the archive rebuild
/// never grows a second standings implementation.
/// </summary>
public static class ArchiveDocumentAdapter
{
    /// <param name="leagueId">
    /// Stamped onto <see cref="TournamentDocument.LeagueId"/>, which the standings passes never read but
    /// which the legacy record requires. Pass the Season ID, or <see cref="string.Empty"/> for a
    /// standalone Tournament.
    /// </param>
    public static TournamentDocument ToLegacyTournament(ArchiveTournamentDocument tournament, string leagueId)
    {
        ArgumentNullException.ThrowIfNull(tournament);
        ArgumentNullException.ThrowIfNull(leagueId);
        return new TournamentDocument(
            tournament.Id,
            leagueId,
            tournament.Name,
            tournament.TournamentDate,
            tournament.Status,
            tournament.Rounds,
            tournament.PlayerArchetypes);
    }
}
```

**`League.cs`**

```csharp
using NodaTime;

namespace Gones.Domain.Archive;

public sealed class League
{
    public const int MaximumDocumentIdLength = 200;
    public const int MaximumNameLength = 200;

    public required string DocumentId { get; init; }
    public string Name { get; private set; } = null!;
    public Instant CreatedAt { get; private set; }
    public Instant UpdatedAt { get; private set; }
    public int Version { get; private set; } = 1;
    public Instant? DeletedAt { get; private set; }

    public static League Create(string documentId, string name, Instant now);
    public void Rename(string name, Instant now);
    public void SoftDelete(Instant now);
}
```

**`LeagueSeason.cs`**

```csharp
using NodaTime;

namespace Gones.Domain.Archive;

public sealed class LeagueSeason
{
    public const int MaximumDocumentIdLength = 200;
    public const int MaximumNameLength = 200;
    public const int MaximumStatusLength = 20;

    public required string DocumentId { get; init; }
    public string LeagueId { get; private set; } = null!;
    public string Name { get; private set; } = null!;
    public string Status { get; private set; } = null!;
    public Instant UpdatedAt { get; private set; }
    public int Version { get; private set; } = 1;
    public Instant? DeletedAt { get; private set; }

    public int TournamentCount { get; private set; }
    public int PlayerCount { get; private set; }
    public LocalDate? FirstTournamentDate { get; private set; }
    public LocalDate? LastTournamentDate { get; private set; }
    public int CountsVersion { get; private set; }

    public static LeagueSeason Create(string documentId, string leagueId, string name, string status, Instant now);
    public void Rename(string name, Instant now);
    public void ChangeStatus(string status, Instant now);
    public void MoveToLeague(string leagueId, Instant now);
    public void SoftDelete(Instant now);

    /// <summary>
    /// Rewrites the denormalized counters from the Season's Tournaments. Deliberately touches neither
    /// <see cref="UpdatedAt"/> nor <see cref="Version"/>: concurrency is per row, and editing a
    /// Tournament must never invalidate a client's copy of its Season.
    /// </summary>
    public void RefreshCatalogCounts(ArchiveSeasonCounts counts);
}
```

`LeagueSeason.Create` stamps `TournamentCount = 0`, `PlayerCount = 0`, `FirstTournamentDate = null`, `LastTournamentDate = null`, `CountsVersion = ArchiveCatalogCounts.Version` — a Season is born with no Tournaments, and that is a computed zero, not an unknown one.

**`Tournament.cs`**

```csharp
using NodaTime;

namespace Gones.Domain.Archive;

public sealed class Tournament
{
    public const int MaximumDocumentIdLength = 200;
    public const int MaximumNameLength = 200;
    public const int MaximumStatusLength = 20;
    public const int MaximumDocumentBytes = 1_048_576;
    public const int MaximumRounds = 1_000;
    public const int MaximumEntries = 100_000;

    public required string DocumentId { get; init; }
    public string? SeasonId { get; private set; }
    public string Name { get; private set; } = null!;
    public LocalDate TournamentDate { get; private set; }
    public string Status { get; private set; } = null!;
    public string Document { get; private set; } = null!;
    public Instant UpdatedAt { get; private set; }
    public int Version { get; private set; } = 1;
    public Instant? DeletedAt { get; private set; }

    public int PlayerCount { get; private set; }
    public int CountsVersion { get; private set; }

    public static Tournament Create(ArchiveTournamentDocument document, Instant now);

    /// <summary>Edits name, date, status, Rounds and archetypes. Refuses a Season change — that is <see cref="MoveToSeason"/>.</summary>
    public void Apply(ArchiveTournamentDocument document, Instant now);

    /// <summary>The move operation, and the way a Tournament is detached to standalone with <c>null</c>.</summary>
    public void MoveToSeason(string? seasonId, Instant now);

    public void SoftDelete(Instant now);

    /// <summary>
    /// Recomputes <see cref="PlayerCount"/> from the stored document without touching
    /// <see cref="UpdatedAt"/> or <see cref="Version"/>: the row's content did not change, only the
    /// number derived from it.
    /// </summary>
    public void RefreshCatalogCounts();

    /// <summary>
    /// The stored document, canonicalized the way a write would store it. Deliberately does **not**
    /// route through <see cref="Create"/>: that path runs a full Swiss standings pass to stamp the
    /// counts, and a read stamps nothing, so it has no counts to compute.
    /// </summary>
    public ArchiveTournamentDocument ReadDocument();
}
```

### Produces — SQL, migration `RebuildArchiveThreeTier`

```sql
CREATE TABLE archive_leagues (
  document_id      text PRIMARY KEY,
  name             text NOT NULL,
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL,
  version          integer NOT NULL,
  deleted_at       timestamptz NULL
);

CREATE TABLE archive_league_seasons (
  document_id            text PRIMARY KEY,
  league_id              text NOT NULL REFERENCES archive_leagues(document_id),
  name                   text NOT NULL,
  status                 text NOT NULL,
  updated_at             timestamptz NOT NULL,
  version                integer NOT NULL,
  deleted_at             timestamptz NULL,
  tournament_count       integer NOT NULL,
  player_count           integer NOT NULL,
  first_tournament_date  date NULL,
  last_tournament_date   date NULL,
  counts_version         integer NOT NULL
);
CREATE INDEX ix_archive_league_seasons_league_id ON archive_league_seasons (league_id);

CREATE TABLE archive_tournaments (
  document_id      text PRIMARY KEY,
  season_id        text NULL REFERENCES archive_league_seasons(document_id),
  name             text NOT NULL,
  tournament_date  date NOT NULL,
  status           text NOT NULL,
  document         jsonb NOT NULL,
  updated_at       timestamptz NOT NULL,
  version          integer NOT NULL,
  deleted_at       timestamptz NULL,
  player_count     integer NOT NULL,
  counts_version   integer NOT NULL
);
CREATE INDEX ix_archive_tournaments_season_id ON archive_tournaments (season_id);
CREATE INDEX ix_archive_tournaments_tournament_date ON archive_tournaments (tournament_date DESC);
```

Additive to the block above, and **only** these two extras — the catalog ordering indexes, mirroring `LeagueArchiveAggregateConfiguration`'s `HasIndex(a => new { a.DeletedAt, a.UpdatedAt, a.Id }).IsDescending(false, true, false)`, because both catalogs order by `updated_at DESC, document_id ASC` over live rows:

```sql
CREATE INDEX ix_archive_leagues_deleted_at_updated_at_document_id
  ON archive_leagues (deleted_at, updated_at DESC, document_id);
CREATE INDEX ix_archive_league_seasons_deleted_at_updated_at_document_id
  ON archive_league_seasons (deleted_at, updated_at DESC, document_id);
```

And these check constraints, mirroring the `ck_league_aggregate_*` family already on `league_archive_aggregates`:

| Table | Constraint name | Expression |
| --- | --- | --- |
| `archive_leagues` | `ck_archive_league_version_positive` | `version > 0` |
| `archive_league_seasons` | `ck_archive_league_season_version_positive` | `version > 0` |
| `archive_league_seasons` | `ck_archive_league_season_status` | `status IN ('active', 'completed')` |
| `archive_league_seasons` | `ck_archive_league_season_counts_non_negative` | `tournament_count >= 0 AND player_count >= 0` |
| `archive_league_seasons` | `ck_archive_league_season_count_dates` | `(first_tournament_date IS NULL) = (last_tournament_date IS NULL) AND (first_tournament_date IS NULL OR first_tournament_date <= last_tournament_date)` |
| `archive_tournaments` | `ck_archive_tournament_version_positive` | `version > 0` |
| `archive_tournaments` | `ck_archive_tournament_status` | `status IN ('active', 'completed')` |
| `archive_tournaments` | `ck_archive_tournament_player_count_non_negative` | `player_count >= 0` |
| `archive_tournaments` | `ck_archive_tournament_document_object` | `jsonb_typeof(document) = 'object'` |
| `archive_tournaments` | `ck_archive_tournament_document_size` | `octet_length(document::text) <= 1048576` |
| `archive_tournaments` | `ck_archive_tournament_document_metadata` | `document ->> 'id' = document_id AND document ->> 'name' = name AND document ->> 'status' = status AND document ->> 'seasonId' IS NOT DISTINCT FROM season_id` |

`ck_archive_tournament_document_metadata` deliberately omits `tournament_date`. Every text→date and date→text conversion in PostgreSQL is `STABLE`, not `IMMUTABLE`, and a `CHECK` constraint rejects a non-immutable expression. The projected `tournament_date` column is authoritative for querying; the document's `tournamentDate` is written from the same value in the same domain call.

`document ->> 'seasonId' IS NOT DISTINCT FROM season_id` holds for a standalone Tournament: `LeagueJson.Options` sets `DefaultIgnoreCondition = WhenWritingNull`, so a null `SeasonId` is omitted from the JSON, and `->>` on an absent key yields SQL `NULL`.

### Produces — EF mapping

New file `backend/src/Gones.Infrastructure/Persistence/ArchiveAggregateConfigurations.cs`, three `internal sealed class …Configuration : IEntityTypeConfiguration<…>`. They are discovered automatically by the existing `modelBuilder.ApplyConfigurationsFromAssembly(typeof(GonesDbContext).Assembly)` — do not register them by hand.

New DbSets on `GonesDbContext`, placed immediately after `public DbSet<LeagueArchiveAggregate> LeagueArchiveAggregates => Set<LeagueArchiveAggregate>();`:

```csharp
public DbSet<League> ArchiveLeagues => Set<League>();
public DbSet<LeagueSeason> ArchiveLeagueSeasons => Set<LeagueSeason>();
public DbSet<Tournament> ArchiveTournaments => Set<Tournament>();
```

### Consumes

- `Gones.Domain.Leagues.LeagueRules.CalculateTournamentResult(TournamentDocument) -> TournamentResult` and `LeagueRules.CalculateLeagueResult(LeagueDocument) -> LeagueResult`, both at `backend/src/Gones.Domain/Leagues/LeagueRules.cs:96` and `:107`. Used unchanged.
- `Gones.Domain.Leagues.LeagueJson.Serialize<T>(T) -> string` and `LeagueJson.Deserialize<T>(string) -> T`.
- `Gones.Domain.Leagues.RoundDocument`, `PlayerArchetypeDocument`, `TournamentDocument`, `LeagueDocument` — reused as-is, never redefined.
- From T1: a migrations directory holding exactly `InitialCreate` and a matching snapshot.

### Errors

Every failure below is an exception thrown by the domain. No HTTP status code is produced by this slice — mapping these onto `400 invalidRequest`, `409 archiveTournamentLocked`, `412 staleArchiveDocument` and friends belongs to the endpoint tickets.

| Where | Exception | Exact message | Raised when |
| --- | --- | --- | --- |
| any `ValidateString` | `ArgumentException` (`paramName` = the field) | `"{field} must contain 1 to {maximumLength} characters."` | value null, blank, whitespace-only or too long. `field` is one of `documentId`, `leagueId`, `seasonId`, `name`, `id`, `round.id`, `entry.id` |
| any `ValidateStatus` | `ArgumentException` (`"status"`) | `"{subject} status must be active or completed."` | `subject` is `"Archive League Season"` or `"Archive Tournament"` |
| `League.Rename` | `InvalidOperationException` | `"Deleted archive League cannot be changed."` | `DeletedAt is not null` |
| `League.SoftDelete` | `InvalidOperationException` | `"Archive League is already deleted."` | `DeletedAt is not null` |
| `LeagueSeason.Rename` / `ChangeStatus` / `MoveToLeague` / `RefreshCatalogCounts` | `InvalidOperationException` | `"Deleted archive League Season cannot be changed."` | `DeletedAt is not null` |
| `LeagueSeason.SoftDelete` | `InvalidOperationException` | `"Archive League Season is already deleted."` | `DeletedAt is not null` |
| `Tournament.Apply` / `MoveToSeason` / `RefreshCatalogCounts` | `InvalidOperationException` | `"Deleted archive Tournament cannot be changed."` | `DeletedAt is not null` |
| `Tournament.SoftDelete` | `InvalidOperationException` | `"Archive Tournament is already deleted."` | `DeletedAt is not null` |
| `Tournament.Apply` | `ArgumentException` (`"document"`) | `"Tournament document ID cannot change."` | `document.Id != DocumentId` |
| `Tournament.Apply` | `ArgumentException` (`"document"`) | `"Tournament Season ID cannot change; use MoveToSeason."` | normalized `document.SeasonId != SeasonId` |
| `Tournament` date parse | `ArgumentException` (`"tournamentDate"`) | `"Tournament date must be an ISO YYYY-MM-DD date."` | `LocalDatePattern.Iso.Parse` fails |
| `Tournament` rounds check | `ArgumentException` (`"document"`) | `"Tournament must contain at most 1000 Rounds."` | `Rounds is null` or `Rounds.Count > MaximumRounds` |
| `Tournament` archetypes check | `ArgumentException` (`"document"`) | `"Tournament player archetypes are required."` | `PlayerArchetypes is null` |
| `Tournament` round check | `ArgumentException` (`"document"`) | `"Round entries are required."` | a `RoundDocument` or its `Entries` is null |
| `Tournament` entry check | `ArgumentException` (`"document"`) | `"Round entry is required."` | a `RoundEntry` is null |
| `Tournament` entry cap | `ArgumentException` (`"document"`) | `"Tournament must contain at most 100000 Round Entries."` | total entries `> MaximumEntries` |
| `Tournament.SerializeBounded` | `ArgumentException` (`"document"`) | `"Tournament document exceeds 1048576 bytes."` | UTF-8 byte count over the cap |
| `Tournament.ReadDocument` | `ArgumentException` (`"document"`) | `"Tournament document is malformed."` | `JsonException` or `NotSupportedException` while deserializing (wrapped as `innerException`) |
| any mutator at `int.MaxValue` | `OverflowException` | (runtime message) | `checked(Version + 1)` overflows |

Message caps are interpolated from the `Maximum*` constants, exactly as `LeagueArchiveAggregate` does — e.g. `$"Tournament must contain at most {MaximumRounds} Rounds."`.

### Invariants

1. **Nothing-changed writes bump nothing.** Every mutator on all three aggregates compares the resulting state with the current state and returns without touching `UpdatedAt` or `Version` when they are equal. For `Tournament.Apply` the comparison is on the serialized canonical document *and* the envelope (`Name`, `TournamentDate`, `Status`). This makes a replayed command idempotent and stops a double-submit turning into a spurious version bump.
2. **`Version` starts at `1` and increases by exactly `1` per state-changing call**, via `checked(Version + 1)`. It is an EF concurrency token, so the `UPDATE` predicate carries its original value.
3. **Counter refreshes never bump `Version` or `UpdatedAt`** — `LeagueSeason.RefreshCatalogCounts` and `Tournament.RefreshCatalogCounts`. Counters are derived, not authored.
4. **`CountsVersion` is `ArchiveCatalogCounts.Version` after `Create`, `Apply` or `RefreshCatalogCounts`, and `0` only if a row was written outside the domain.** `0` means "never computed", which is what makes a stored `0` count unambiguous.
5. `LeagueSeason.FirstTournamentDate` and `LastTournamentDate` are both `null` or both non-null, and `First <= Last`. Both are `null` exactly when `TournamentCount == 0`.
6. `Tournament.SeasonId` is `null` **or** a 1..200-character string. Empty and whitespace-only both normalize to `null`. `null` means standalone.
7. `Tournament.Document` always parses back to an `ArchiveTournamentDocument` whose `Id`, `Name`, `Status` equal the envelope columns, whose `SeasonId` equals `SeasonId`, and whose `TournamentDate` formats to `TournamentDate` as `uuuu-MM-dd`.
8. `Tournament.ReadDocument()` runs **no** standings pass. Its cost is parse + canonicalize + parse, and nothing more.
9. `SoftDelete` sets `DeletedAt = now` **and** `UpdatedAt = now` **and** bumps `Version`. A deleted row refuses every further mutation.
10. `League.CreatedAt` is set once by `Create` and never changes. `archive_league_seasons` and `archive_tournaments` have **no** `created_at` column — do not add one.
11. Dates are compared as whole UTC calendar days. `ArchiveLockRule.IsLocked` never consults a wall clock; `today` is always passed in by the caller.
12. `ArchiveCatalogCounts.Version` is one shared constant for both tables. Changing how *any* of the five counters is derived is one bump.

## TDD

1. **Red** — write the three test files first, in this order: `ArchiveLockRuleTests.cs`, `ArchiveCatalogCountsTests.cs`, `ArchiveAggregateTests.cs`. In C# "red" is a compile failure until the types exist, which is the intended first state. Confirm it: `dotnet test backend/tests/Gones.UnitTests/Gones.UnitTests.csproj --configuration Release` must fail with `CS0246: The type or namespace name 'Archive' does not exist in the namespace 'Gones.Domain'`. Do not write a line of production code before you have seen that.
2. **Green** — add `ArchiveDocuments.cs`, `ArchiveLockRule.cs`, `ArchiveDocumentAdapter.cs`, `ArchiveCatalogCounts.cs`, `League.cs`, `LeagueSeason.cs`, `Tournament.cs` until `dotnet test backend/tests/Gones.UnitTests/Gones.UnitTests.csproj --configuration Release` is green. Then and only then add the EF configuration, the DbSets and the migration.
3. **Refactor** — only to remove duplication between the three aggregates' guard clauses. Keep every test green. Do not extract a shared base class: `League` has a `CreatedAt` the other two do not, and `Tournament` has a document the other two do not, so a base class would be one field-set with three shapes.

## Test plan

All in `backend/tests/Gones.UnitTests/`. Run with `dotnet test backend/tests/Gones.UnitTests/Gones.UnitTests.csproj --configuration Release` (no Docker needed — these are pure domain tests).

### `ArchiveLockRuleTests.cs`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `The_day_it_was_played_is_not_locked` | `IsLocked(2026-08-22, 2026-08-22)` | `false` |
| `Exactly_365_days_old_is_not_locked` | `IsLocked(2025-08-22, 2026-08-22)` | `false` |
| `Three_hundred_and_sixty_six_days_old_is_locked` | `IsLocked(2025-08-21, 2026-08-22)` | `true` |
| `Counts_whole_calendar_days_across_a_leap_day` | `IsLocked(2027-03-01, 2028-02-29)` then `IsLocked(2027-03-01, 2028-03-01)` | `false` then `true` — 2028-02-29 is day 365, 2028-03-01 is day 366 |
| `A_future_date_is_never_locked` | `IsLocked(2027-01-01, 2026-08-22)` | `false` |
| `The_lock_window_is_three_hundred_and_sixty_five_days` | `ArchiveLockRule.LockWindowDays` | `365` |

### `ArchiveCatalogCountsTests.cs`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `Counts_an_empty_Season_as_zero_with_no_dates` | `ForSeason("s1", [])` | `new ArchiveSeasonCounts(0, 0, null, null)` |
| `Counts_Tournaments_including_incomplete_ones` | `ForSeason("s1", [T with 1 match, T with 1 match, T with no Rounds])` | `.TournamentCount == 3` |
| `Counts_distinct_players_across_a_Season` | two Tournaments, `Ada vs Bo` then `Ada vs Cy` | `.PlayerCount == 3` — Ada holds one standings row |
| `Matches_CalculateLeagueResult_row_count` | any two-Tournament Season | `.PlayerCount == LeagueRules.CalculateLeagueResult(equivalent LeagueDocument).Rows.Count` |
| `Reports_the_first_and_last_Tournament_dates` | Tournaments dated `2026-03-04`, `2026-01-02`, `2026-07-08` | `.FirstTournamentDate == new LocalDate(2026, 1, 2)` and `.LastTournamentDate == new LocalDate(2026, 7, 8)` |
| `Counts_one_Tournament_players_with_the_standings_row_count` | `ForTournament(T with Ada vs Bo, Cy vs Dot)` | `.PlayerCount == 4`, and `== LeagueRules.CalculateTournamentResult(equivalent TournamentDocument).Rows.Count` |
| `Counts_a_standalone_Tournament` | `ForTournament(T with SeasonId: null)` | `.PlayerCount == 2` — no exception, no League needed |
| `Counts_an_empty_Tournament_as_zero` | `ForTournament(T with no Rounds)` | `.PlayerCount == 0` |

### `ArchiveAggregateTests.cs`

| Test | Input | Expect |
| ---- | ----- | ------ |
| `League_Create_starts_at_version_one` | `League.Create("l1", "Lyon", Now)` | `Version == 1`, `CreatedAt == Now`, `UpdatedAt == Now`, `DeletedAt is null`, `Name == "Lyon"` |
| `League_Create_rejects_a_blank_name` | `League.Create("l1", "  ", Now)` | `ArgumentException` with message `"name must contain 1 to 200 characters."` |
| `League_Rename_bumps_the_version_and_the_timestamp` | rename to `"Lyon 2"` at `Now + 1h` | `Name == "Lyon 2"`, `Version == 2`, `UpdatedAt == Now + 1h`, `CreatedAt == Now` |
| `League_Rename_to_the_same_name_changes_nothing` | rename to `"Lyon"` at `Now + 1h` | `Version == 1`, `UpdatedAt == Now` |
| `League_SoftDelete_stamps_the_deletion` | `SoftDelete(Now + 1h)` | `DeletedAt == Now + 1h`, `UpdatedAt == Now + 1h`, `Version == 2` |
| `A_deleted_League_refuses_a_rename` | `SoftDelete` then `Rename` | `InvalidOperationException` `"Deleted archive League cannot be changed."` |
| `A_deleted_League_refuses_a_second_delete` | `SoftDelete` twice | `InvalidOperationException` `"Archive League is already deleted."` |
| `Season_Create_stamps_zero_counts_at_the_current_version` | `LeagueSeason.Create("s1", "l1", "2026", "active", Now)` | `TournamentCount == 0`, `PlayerCount == 0`, `FirstTournamentDate is null`, `LastTournamentDate is null`, `CountsVersion == ArchiveCatalogCounts.Version`, `Version == 1` |
| `Season_Create_requires_a_League` | `LeagueSeason.Create("s1", "", "2026", "active", Now)` | `ArgumentException` `"leagueId must contain 1 to 200 characters."` |
| `Season_Create_rejects_an_unknown_status` | status `"archived"` | `ArgumentException` `"Archive League Season status must be active or completed."` |
| `Season_ChangeStatus_bumps_the_version` | `ChangeStatus("completed", Now + 1h)` | `Status == "completed"`, `Version == 2`, `UpdatedAt == Now + 1h` |
| `Season_MoveToLeague_bumps_the_version` | `MoveToLeague("l2", Now + 1h)` | `LeagueId == "l2"`, `Version == 2` |
| `Season_MoveToLeague_to_the_same_League_changes_nothing` | `MoveToLeague("l1", Now + 1h)` | `Version == 1`, `UpdatedAt == Now` |
| `Season_RefreshCatalogCounts_writes_the_counters_without_bumping_the_row` | `RefreshCatalogCounts(new ArchiveSeasonCounts(3, 7, d1, d2))` at any time | `TournamentCount == 3`, `PlayerCount == 7`, `FirstTournamentDate == d1`, `LastTournamentDate == d2`, `CountsVersion == ArchiveCatalogCounts.Version`, **`Version == 1`**, **`UpdatedAt == Now`** |
| `A_deleted_Season_refuses_a_rename` | `SoftDelete` then `Rename` | `InvalidOperationException` `"Deleted archive League Season cannot be changed."` |
| `Tournament_Create_projects_the_envelope_and_the_counts` | `Create(Doc("t1", seasonId: "s1", date: "2026-05-04", Ada vs Bo), Now)` | `Name`, `Status` from the document; `SeasonId == "s1"`; `TournamentDate == new LocalDate(2026, 5, 4)`; `PlayerCount == 2`; `CountsVersion == ArchiveCatalogCounts.Version`; `Version == 1` |
| `Tournament_Create_accepts_a_standalone_Tournament` | `Create(Doc(seasonId: null), Now)` | `SeasonId is null`, and `ReadDocument().SeasonId is null` |
| `Tournament_Create_normalizes_a_blank_Season_to_standalone` | `Create(Doc(seasonId: "   "), Now)` | `SeasonId is null` |
| `Tournament_Create_rejects_a_non_ISO_date` | `tournamentDate: "04/05/2026"` | `ArgumentException` `"Tournament date must be an ISO YYYY-MM-DD date."` |
| `Tournament_Create_rejects_an_unknown_status` | `status: "draft"` | `ArgumentException` `"Archive Tournament status must be active or completed."` |
| `Tournament_Create_rejects_too_many_Rounds` | 1001 empty `RoundDocument`s | `ArgumentException` `"Tournament must contain at most 1000 Rounds."` |
| `ReadDocument_returns_the_stored_document` | `Create(doc, Now).ReadDocument()` | every field equals `doc`: `Id`, `Name`, `SeasonId`, `TournamentDate`, `Status`, and the flattened entry ID sequence |
| `Tournament_Apply_recomputes_the_player_count` | `Create` with `Ada vs Bo`, then `Apply` with `Ada vs Bo` **and** `Cy vs Dot` at `Now + 1h` | `PlayerCount == 4`, `CountsVersion == ArchiveCatalogCounts.Version`, `Version == 2`, `UpdatedAt == Now + 1h` |
| `Tournament_Apply_with_an_identical_document_changes_nothing` | `Apply(sameDoc, Now + 1h)` | `Version == 1`, `UpdatedAt == Now` |
| `Tournament_Apply_rejects_a_document_ID_change` | `Apply(Doc("t2", …), …)` | `ArgumentException` `"Tournament document ID cannot change."` |
| `Tournament_Apply_rejects_a_Season_change` | `Apply(same doc with seasonId "s2")` | `ArgumentException` `"Tournament Season ID cannot change; use MoveToSeason."` |
| `MoveToSeason_rewrites_the_stored_document` | `MoveToSeason("s2", Now + 1h)` | `SeasonId == "s2"`, `ReadDocument().SeasonId == "s2"`, `Version == 2`, `PlayerCount` unchanged |
| `MoveToSeason_null_detaches_to_standalone` | `MoveToSeason(null, Now + 1h)` | `SeasonId is null`, `ReadDocument().SeasonId is null`, `Version == 2` |
| `MoveToSeason_to_the_current_Season_changes_nothing` | `MoveToSeason("s1", Now + 1h)` | `Version == 1`, `UpdatedAt == Now` |
| `Tournament_RefreshCatalogCounts_does_not_bump_the_row` | `RefreshCatalogCounts()` | `PlayerCount` recomputed, `CountsVersion == ArchiveCatalogCounts.Version`, **`Version == 1`**, **`UpdatedAt == Now`** |
| `A_deleted_Tournament_refuses_a_write` | `SoftDelete` then `Apply` | `InvalidOperationException` `"Deleted archive Tournament cannot be changed."` |
| `ReadDocument_does_not_recompute_the_standings` | allocation counter, see 1.4 below | `read < parse + (standings / 2)` |

Assertion idiom, matching the repo: `Assert.Equal(expected, actual)`, and for throws
`Assert.Equal("…", Assert.Throws<ArgumentException>(() => …).Message)` — note `ArgumentException.Message`
appends `" (Parameter 'x')"`, so assert with `Assert.StartsWith("…", exception.Message)` for the
`ArgumentException` cases and plain `Assert.Equal` for the `InvalidOperationException` ones.

## Impl steps

- [ ] **1. Red: write the three failing test files**
  - [ ] 1.1 Create `backend/tests/Gones.UnitTests/ArchiveLockRuleTests.cs`. Header: `using Gones.Domain.Archive;`, `using NodaTime;`, `namespace Gones.UnitTests;`, `public sealed class ArchiveLockRuleTests`. Write the six `[Fact]`s from the *Test plan* table, each calling `ArchiveLockRule.IsLocked(new LocalDate(y, m, d), new LocalDate(y, m, d))`.
  - [ ] 1.2 Create `backend/tests/Gones.UnitTests/ArchiveCatalogCountsTests.cs` with the eight `[Fact]`s from the table. Put these builders at the bottom of the class:
    ```csharp
    private static ArchiveTournamentDocument Tournament(string id, string? seasonId, string date, params RoundEntry[] entries) =>
        new(id, $"Tournament {id}", seasonId, date, "completed",
            entries.Length == 0 ? [] : [new RoundDocument($"{id}-r1", entries)], []);

    private static MatchRoundEntry Match(string id, string player1, string player2, int score1, int score2) =>
        new(id, "1", player1, player2, score1, score2, string.Empty, string.Empty);
    ```
    with `using Gones.Domain.Archive;`, `using Gones.Domain.Leagues;`, `using NodaTime;`.
  - [ ] 1.3 Create `backend/tests/Gones.UnitTests/ArchiveAggregateTests.cs` with every `[Fact]` from the third table. Declare `private static readonly Instant Now = Instant.FromUtc(2026, 5, 4, 12, 0);` and reuse the same two builders as 1.2.
  - [ ] 1.4 Append to `ArchiveAggregateTests.cs` the allocation guard, copied from `backend/tests/Gones.UnitTests/LeagueArchiveAggregateReadTests.cs:76-114` and retargeted:
    ```csharp
    /// <summary>
    /// A read must not pay for the standings. <c>Create</c> and <c>Apply</c> stamp the player count and
    /// therefore run a full Swiss pass; <c>ReadDocument</c> stamps nothing, so it has nothing to compute.
    /// </summary>
    [Fact]
    public void ReadDocument_does_not_recompute_the_standings()
    {
        var aggregate = Tournament.Create(BigTournament(), Now);
        var canonical = aggregate.Document;

        // Warm every path so one-off JIT and static-init allocations stay out of the measurements.
        aggregate.ReadDocument();
        Parse(canonical);
        ArchiveCatalogCounts.ForTournament(aggregate.ReadDocument());

        var parse = Allocated(() => Parse(canonical));
        var standings = Allocated(() => ArchiveCatalogCounts.ForTournament(Parse(canonical))) - parse;
        var read = Allocated(() => aggregate.ReadDocument());

        Assert.True(
            read < parse + (standings / 2),
            $"read={read} bytes, parse={parse} bytes, standings={standings} bytes");
    }

    /// <summary>The work a read cannot avoid: parse the stored JSON, canonicalize it, parse that.</summary>
    private static ArchiveTournamentDocument Parse(string canonical) =>
        LeagueJson.Deserialize<ArchiveTournamentDocument>(
            LeagueJson.Serialize(LeagueJson.Deserialize<ArchiveTournamentDocument>(canonical)));

    private static long Allocated(Action action)
    {
        var before = GC.GetAllocatedBytesForCurrentThread();
        action();
        return GC.GetAllocatedBytesForCurrentThread() - before;
    }

    /// <summary>Big enough that a standings pass is not lost in the noise: 5 Rounds, 80 Matches.</summary>
    private static ArchiveTournamentDocument BigTournament() => new(
        "big-tournament",
        "Big Tournament",
        "big-season",
        "2026-05-04",
        "completed",
        [.. Enumerable.Range(0, 5).Select(BigRound)],
        []);

    private static RoundDocument BigRound(int round) => new(
        $"big-tournament-r{round}",
        [.. Enumerable.Range(0, 16).Select(match => new MatchRoundEntry(
            $"big-tournament-r{round}-m{match}",
            (round + 1).ToString(System.Globalization.CultureInfo.InvariantCulture),
            $"Player {match * 2}",
            $"Player {(match * 2) + 1}",
            2,
            match % 3,
            "Tempo",
            "Control"))]);
    ```
  - [ ] 1.5 Run `dotnet test backend/tests/Gones.UnitTests/Gones.UnitTests.csproj --configuration Release` and confirm it fails to compile with `CS0246 … 'Archive' does not exist in the namespace 'Gones.Domain'`.

- [ ] **2. Documents and validation helper**
  - [ ] 2.1 Create the directory `backend/src/Gones.Domain/Archive/`.
  - [ ] 2.2 Create `backend/src/Gones.Domain/Archive/ArchiveDocuments.cs` with exactly the contents given in *Interface contract → Produces → C# domain → `ArchiveDocuments.cs`*: `ArchiveLeagueDocument`, `LeagueSeasonDocument`, `ArchiveTournamentDocument`, `internal static class ArchiveValidation`.

- [ ] **3. The lock rule**
  - [ ] 3.1 Create `backend/src/Gones.Domain/Archive/ArchiveLockRule.cs` with exactly the contents given in the contract. `Period.Between(start, end, PeriodUnits.Days).Days` is negative when `end < start`, which is what makes a future date not locked without a second branch.
  - [ ] 3.2 Run `dotnet test backend/tests/Gones.UnitTests/Gones.UnitTests.csproj --configuration Release --filter "FullyQualifiedName~ArchiveLockRuleTests"` — still red on the other files' compile errors is expected; move on once `ArchiveLockRule.cs` itself compiles under `dotnet build backend/src/Gones.Domain/Gones.Domain.csproj`.

- [ ] **4. Counts and the standings adapter**
  - [ ] 4.1 Create `backend/src/Gones.Domain/Archive/ArchiveDocumentAdapter.cs` with exactly the contents given in the contract.
  - [ ] 4.2 Create `backend/src/Gones.Domain/Archive/ArchiveCatalogCounts.cs` with the two records, `public const int Version = 1;`, and the two method bodies given verbatim in the contract, plus the private `ParseOrNull`.
  - [ ] 4.3 Run `dotnet test backend/tests/Gones.UnitTests/Gones.UnitTests.csproj --configuration Release --filter "FullyQualifiedName~ArchiveCatalogCountsTests"` once step 5 has made the file compile; if you want it green earlier, temporarily comment out `ArchiveAggregateTests.cs` — do not commit that.

- [ ] **5. The three aggregates**
  - [ ] 5.1 Create `backend/src/Gones.Domain/Archive/League.cs`. Fields and signatures exactly as the contract. `Create` calls `ArchiveValidation.ValidateString(documentId, "documentId", MaximumDocumentIdLength)` and `ArchiveValidation.ValidateString(name, "name", MaximumNameLength)`, then returns `new League { DocumentId = documentId, Name = name, CreatedAt = now, UpdatedAt = now }`. `Rename` guards `DeletedAt`, validates, returns early when `name == Name`, else sets `Name`, `UpdatedAt = now`, `Version = checked(Version + 1)`. `SoftDelete` guards, sets `DeletedAt = now`, `UpdatedAt = now`, bumps `Version`.
  - [ ] 5.2 Create `backend/src/Gones.Domain/Archive/LeagueSeason.cs`. Same pattern. `Create` validates `documentId`, `leagueId`, `name` and `ArchiveValidation.ValidateStatus(status, "Archive League Season")`, then stamps `CountsVersion = ArchiveCatalogCounts.Version` with all four counters at their empty values. `RefreshCatalogCounts(ArchiveSeasonCounts counts)` guards `DeletedAt`, `ArgumentNullException.ThrowIfNull(counts)`, assigns the four counters and `CountsVersion = ArchiveCatalogCounts.Version`, and **touches nothing else** — no `UpdatedAt`, no `Version`.
  - [ ] 5.3 Create `backend/src/Gones.Domain/Archive/Tournament.cs`. Add these private members alongside the public surface:
    ```csharp
    private static string SerializeBounded(ArchiveTournamentDocument document)
    {
        var canonical = LeagueJson.Serialize(document);
        if (Encoding.UTF8.GetByteCount(canonical) > MaximumDocumentBytes)
            throw new ArgumentException($"Tournament document exceeds {MaximumDocumentBytes} bytes.", nameof(document));
        return canonical;
    }

    private static LocalDate ParseTournamentDate(string? value)
    {
        ArchiveValidation.ValidateString(value, "tournamentDate", 32);
        var parse = LocalDatePattern.Iso.Parse(value!);
        if (!parse.Success)
            throw new ArgumentException("Tournament date must be an ISO YYYY-MM-DD date.", "tournamentDate");
        return parse.Value;
    }

    private static void ValidateDocument(ArchiveTournamentDocument? document)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArchiveValidation.ValidateString(document.Id, "id", MaximumDocumentIdLength);
        ArchiveValidation.ValidateString(document.Name, "name", MaximumNameLength);
        ArchiveValidation.ValidateStatus(document.Status, "Archive Tournament");
        if (document.Rounds is null || document.Rounds.Count > MaximumRounds)
            throw new ArgumentException($"Tournament must contain at most {MaximumRounds} Rounds.", nameof(document));
        if (document.PlayerArchetypes is null)
            throw new ArgumentException("Tournament player archetypes are required.", nameof(document));

        var entryCount = 0;
        foreach (var round in document.Rounds)
        {
            if (round is null || round.Entries is null)
                throw new ArgumentException("Round entries are required.", nameof(document));
            ArchiveValidation.ValidateString(round.Id, "round.id", MaximumDocumentIdLength);
            entryCount = checked(entryCount + round.Entries.Count);
            foreach (var entry in round.Entries)
            {
                if (entry is null) throw new ArgumentException("Round entry is required.", nameof(document));
                ArchiveValidation.ValidateString(entry.Id, "entry.id", MaximumDocumentIdLength);
            }
        }
        if (entryCount > MaximumEntries)
            throw new ArgumentException($"Tournament must contain at most {MaximumEntries} Round Entries.", nameof(document));
    }
    ```
    Required usings for the file: `using System.Text;`, `using System.Text.Json;`, `using Gones.Domain.Leagues;`, `using NodaTime;`, `using NodaTime.Text;`.
  - [ ] 5.4 In the same file, write `Create`: validate, `ParseTournamentDate(document.TournamentDate)`, `ArchiveValidation.NormalizeSeasonId(document.SeasonId, MaximumDocumentIdLength)`, build the **normalized** document with `document with { SeasonId = normalizedSeasonId }` so the stored JSON and the column agree, then
    ```csharp
    return new Tournament
    {
        DocumentId = normalized.Id,
        SeasonId = normalized.SeasonId,
        Name = normalized.Name,
        TournamentDate = date,
        Status = normalized.Status,
        Document = SerializeBounded(normalized),
        UpdatedAt = now,
        PlayerCount = ArchiveCatalogCounts.ForTournament(normalized).PlayerCount,
        CountsVersion = ArchiveCatalogCounts.Version
    };
    ```
  - [ ] 5.5 Write `Apply(ArchiveTournamentDocument document, Instant now)`: guard `DeletedAt` → `InvalidOperationException("Deleted archive Tournament cannot be changed.")`; `if (document.Id != DocumentId) throw new ArgumentException("Tournament document ID cannot change.", nameof(document));`; `if (ArchiveValidation.NormalizeSeasonId(document.SeasonId, MaximumDocumentIdLength) != SeasonId) throw new ArgumentException("Tournament Season ID cannot change; use MoveToSeason.", nameof(document));`; `ValidateDocument`; parse the date; build `normalized = document with { SeasonId = SeasonId }`; `var canonical = SerializeBounded(normalized);`; **return early** when `canonical == Document && normalized.Name == Name && date == TournamentDate && normalized.Status == Status`; otherwise assign `Name`, `TournamentDate`, `Status`, `Document = canonical`, `UpdatedAt = now`, `Version = checked(Version + 1)`, `PlayerCount = ArchiveCatalogCounts.ForTournament(normalized).PlayerCount`, `CountsVersion = ArchiveCatalogCounts.Version`.
  - [ ] 5.6 Write `MoveToSeason(string? seasonId, Instant now)`: guard `DeletedAt`; `var target = ArchiveValidation.NormalizeSeasonId(seasonId, MaximumDocumentIdLength);`; `if (target == SeasonId) return;`; `var moved = ReadDocument() with { SeasonId = target };` then assign `SeasonId = target`, `Document = SerializeBounded(moved)`, `UpdatedAt = now`, `Version = checked(Version + 1)`. **Do not** recompute the counts — moving a Tournament changes no player.
  - [ ] 5.7 Write `SoftDelete(Instant now)`: `if (DeletedAt is not null) throw new InvalidOperationException("Archive Tournament is already deleted.");` then `DeletedAt = now; UpdatedAt = now; Version = checked(Version + 1);`.
  - [ ] 5.8 Write `RefreshCatalogCounts()`: guard `DeletedAt`; `PlayerCount = ArchiveCatalogCounts.ForTournament(ReadDocument()).PlayerCount; CountsVersion = ArchiveCatalogCounts.Version;`. Nothing else.
  - [ ] 5.9 Write `ReadDocument()`:
    ```csharp
    public ArchiveTournamentDocument ReadDocument()
    {
        try
        {
            return LeagueJson.Deserialize<ArchiveTournamentDocument>(Document);
        }
        catch (Exception exception) when (exception is JsonException or NotSupportedException)
        {
            throw new ArgumentException("Tournament document is malformed.", "document", exception);
        }
    }
    ```
    No `Create`, no `ValidateDocument`, no counts — that is the whole point of invariant 8.
  - [ ] 5.10 Run `dotnet test backend/tests/Gones.UnitTests/Gones.UnitTests.csproj --configuration Release`. Every new test must be green before you touch persistence.

- [ ] **6. EF mapping and DbSets**
  - [ ] 6.1 Create `backend/src/Gones.Infrastructure/Persistence/ArchiveAggregateConfigurations.cs` with `using Gones.Domain.Archive;`, `using Microsoft.EntityFrameworkCore;`, `using Microsoft.EntityFrameworkCore.Metadata.Builders;`, `namespace Gones.Infrastructure.Persistence;` and `internal sealed class ArchiveLeagueConfiguration : IEntityTypeConfiguration<League>`:
    ```csharp
    public void Configure(EntityTypeBuilder<League> builder)
    {
        builder.ToTable("archive_leagues");
        builder.HasKey(league => league.DocumentId);
        builder.Property(league => league.DocumentId).HasColumnType("text");
        builder.Property(league => league.Name).HasColumnType("text");
        builder.Property(league => league.Version).IsConcurrencyToken();
        builder.HasIndex(league => new { league.DeletedAt, league.UpdatedAt, league.DocumentId })
            .IsDescending(false, true, false);
        builder.ToTable(table => table.HasCheckConstraint("ck_archive_league_version_positive", "version > 0"));
    }
    ```
    The `text` column type is deliberate: the binding DDL says `text`, the 200-character cap is a domain rule enforced by `ArchiveValidation.ValidateString`, and `HasMaxLength` would emit `character varying(200)` instead. Same precedent as `PlayerStatisticsRowConfiguration`'s `HasColumnType("text")` on `player_name`.
  - [ ] 6.2 In the same file add `internal sealed class ArchiveLeagueSeasonConfiguration : IEntityTypeConfiguration<LeagueSeason>`:
    ```csharp
    public void Configure(EntityTypeBuilder<LeagueSeason> builder)
    {
        builder.ToTable("archive_league_seasons");
        builder.HasKey(season => season.DocumentId);
        builder.Property(season => season.DocumentId).HasColumnType("text");
        builder.Property(season => season.LeagueId).HasColumnType("text");
        builder.Property(season => season.Name).HasColumnType("text");
        builder.Property(season => season.Status).HasColumnType("text");
        builder.Property(season => season.Version).IsConcurrencyToken();
        builder.HasOne<League>()
            .WithMany()
            .HasForeignKey(season => season.LeagueId)
            .OnDelete(DeleteBehavior.NoAction);
        builder.HasIndex(season => season.LeagueId);
        builder.HasIndex(season => new { season.DeletedAt, season.UpdatedAt, season.DocumentId })
            .IsDescending(false, true, false);
        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_archive_league_season_version_positive", "version > 0");
            table.HasCheckConstraint("ck_archive_league_season_status", "status IN ('active', 'completed')");
            table.HasCheckConstraint("ck_archive_league_season_counts_non_negative", "tournament_count >= 0 AND player_count >= 0");
            table.HasCheckConstraint(
                "ck_archive_league_season_count_dates",
                "(first_tournament_date IS NULL) = (last_tournament_date IS NULL) AND (first_tournament_date IS NULL OR first_tournament_date <= last_tournament_date)");
        });
    }
    ```
    `DeleteBehavior.NoAction` matches the binding DDL's bare `REFERENCES` (PostgreSQL `ON DELETE NO ACTION`). Do not use the EF default, which would emit `ON DELETE CASCADE` for a required relationship.
    The explicit `HasIndex(season => season.LeagueId)` is what gives the FK index the contract's name `ix_archive_league_seasons_league_id`; without it EF invents its own and you get a duplicate.
  - [ ] 6.3 In the same file add `internal sealed class ArchiveTournamentConfiguration : IEntityTypeConfiguration<Tournament>`:
    ```csharp
    public void Configure(EntityTypeBuilder<Tournament> builder)
    {
        builder.ToTable("archive_tournaments");
        builder.HasKey(tournament => tournament.DocumentId);
        builder.Property(tournament => tournament.DocumentId).HasColumnType("text");
        builder.Property(tournament => tournament.SeasonId).HasColumnType("text");
        builder.Property(tournament => tournament.Name).HasColumnType("text");
        builder.Property(tournament => tournament.Status).HasColumnType("text");
        builder.Property(tournament => tournament.Document).HasColumnType("jsonb");
        builder.Property(tournament => tournament.Version).IsConcurrencyToken();
        builder.HasOne<LeagueSeason>()
            .WithMany()
            .HasForeignKey(tournament => tournament.SeasonId)
            .OnDelete(DeleteBehavior.NoAction);
        builder.HasIndex(tournament => tournament.SeasonId);
        builder.HasIndex(tournament => tournament.TournamentDate).IsDescending();
        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_archive_tournament_version_positive", "version > 0");
            table.HasCheckConstraint("ck_archive_tournament_status", "status IN ('active', 'completed')");
            table.HasCheckConstraint("ck_archive_tournament_player_count_non_negative", "player_count >= 0");
            table.HasCheckConstraint("ck_archive_tournament_document_object", "jsonb_typeof(document) = 'object'");
            table.HasCheckConstraint("ck_archive_tournament_document_size", $"octet_length(document::text) <= {Tournament.MaximumDocumentBytes}");
            table.HasCheckConstraint(
                "ck_archive_tournament_document_metadata",
                "document ->> 'id' = document_id AND document ->> 'name' = name AND document ->> 'status' = status AND document ->> 'seasonId' IS NOT DISTINCT FROM season_id");
        });
    }
    ```
  - [ ] 6.4 Edit `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs`: add `using Gones.Domain.Archive;` to the using block (alphabetically it goes first, before `using Gones.Domain.Calendar;`), and insert the three DbSet properties from the contract immediately after the `LeagueArchiveAggregates` line. If the compiler reports `CS0104` on `League`, `LeagueSeason` or `Tournament`, resolve it with file-scoped aliases at the top of that file — `using ArchiveLeague = Gones.Domain.Archive.League;` and friends — and use the aliases in the DbSet declarations. (No such type exists in the other imported namespaces today, so this should not fire.)
  - [ ] 6.5 Do **not** touch `IncrementVersions()` or the `VersionedEntity` loop in `OnModelCreating`. The three new aggregates deliberately do not derive from `Gones.Domain.Persistence.VersionedEntity`: that base carries a `Guid Id` primary key and a `long Version`, and the binding DDL says `document_id text PRIMARY KEY` and `version integer`. They own their version bump instead, which is why every mutator ends in `Version = checked(Version + 1)`.
  - [ ] 6.6 Run `npm run backend:build` and confirm it is clean.

- [ ] **7. The migration**
  - [ ] 7.1 If `backend/.tmp-tools/dotnet-ef` is missing, reinstall it: `cd /home/aron/projects/gones/backend && dotnet tool install dotnet-ef --version 10.0.4 --tool-path .tmp-tools`.
  - [ ] 7.2 Scaffold the migration:
    ```bash
    cd /home/aron/projects/gones/backend && \
    GONES_DB_CONNECTION='Host=localhost;Port=5432;Database=gones;Username=gones_migration;Password=local-migration-only' \
    ./.tmp-tools/dotnet-ef migrations add RebuildArchiveThreeTier \
      --project src/Gones.Infrastructure/Gones.Infrastructure.csproj \
      --startup-project src/Gones.Infrastructure/Gones.Infrastructure.csproj \
      --context GonesDbContext \
      --output-dir Persistence/Migrations
    ```
    `GONES_DB_CONNECTION` only has to be **set** — `GonesDbContextFactory` reads it, and scaffolding never opens the connection. The startup project is `Gones.Infrastructure`, not `Gones.Api`: `Gones.Api` does not reference `Microsoft.EntityFrameworkCore.Design`, so pointing at it fails.
  - [ ] 7.3 Open the generated `backend/src/Gones.Infrastructure/Persistence/Migrations/*_RebuildArchiveThreeTier.cs` and verify by reading, not by assuming:
    - `Up` contains exactly three `migrationBuilder.CreateTable` calls — `archive_leagues`, `archive_league_seasons`, `archive_tournaments` — and **zero** `DropTable` calls. `MigrationSafetyTests.No_migration_renames_a_table_by_dropping_and_recreating_it` fails the build if a `Up` both drops and creates.
    - Column types read `text`, `timestamp with time zone`, `integer`, `date`, `jsonb` — matching the DDL. Nothing is `character varying`.
    - The FKs carry `onDelete: ReferentialAction.NoAction` (EF may omit the argument entirely, which is the same thing).
    - Five `CreateIndex` calls: `ix_archive_league_seasons_league_id`, `ix_archive_tournaments_season_id`, `ix_archive_tournaments_tournament_date` (descending), `ix_archive_leagues_deleted_at_updated_at_document_id`, `ix_archive_league_seasons_deleted_at_updated_at_document_id`.
    - The eleven `ck_archive_*` check constraints are present in the `constraints:` blocks.
    - No other table appears anywhere in the file.
  - [ ] 7.4 Confirm `git status --short backend/src/Gones.Infrastructure/Persistence/Migrations/` lists exactly three new files: `*_RebuildArchiveThreeTier.cs`, `*_RebuildArchiveThreeTier.Designer.cs`, and a modified `GonesDbContextModelSnapshot.cs`. If it lists more, or a second migration, delete them with `./.tmp-tools/dotnet-ef migrations remove` and rerun 7.2.
  - [ ] 7.5 Confirm no migration outside yours was modified: `git diff --stat backend/src/Gones.Infrastructure/Persistence/Migrations/` must show only `GonesDbContextModelSnapshot.cs`.

- [ ] **8. Green and verify**
  - [ ] 8.1 `npm run backend:build` — clean, zero warnings.
  - [ ] 8.2 `npm run backend:test` — all green except, possibly, the one pre-existing `MigrationSafetyTests.Rename_migrations_never_drop_or_recreate_the_table_they_rename` failure described in *Assumptions in force → 6*. `MigrationSafetyTests.Committed_migrations_fully_describe_the_model` **must** pass; if it does not, your model and your migration disagree — rerun 7.2 after removing the stale one.
  - [ ] 8.3 `npm run db:reset` then start the stack and confirm the API boots and `/api/leagues-archive/all` still answers `200` — this slice must leave the legacy surface working.
  - [ ] 8.4 Confirm nothing outside the fence moved: `git status --short` must list only the files named in *Outputs*.

## Outputs

**Files added:**

- `backend/src/Gones.Domain/Archive/ArchiveDocuments.cs`
- `backend/src/Gones.Domain/Archive/ArchiveLockRule.cs`
- `backend/src/Gones.Domain/Archive/ArchiveDocumentAdapter.cs`
- `backend/src/Gones.Domain/Archive/ArchiveCatalogCounts.cs`
- `backend/src/Gones.Domain/Archive/League.cs`
- `backend/src/Gones.Domain/Archive/LeagueSeason.cs`
- `backend/src/Gones.Domain/Archive/Tournament.cs`
- `backend/src/Gones.Infrastructure/Persistence/ArchiveAggregateConfigurations.cs`
- `backend/src/Gones.Infrastructure/Persistence/Migrations/<timestamp>_RebuildArchiveThreeTier.cs`
- `backend/src/Gones.Infrastructure/Persistence/Migrations/<timestamp>_RebuildArchiveThreeTier.Designer.cs`
- `backend/tests/Gones.UnitTests/ArchiveLockRuleTests.cs`
- `backend/tests/Gones.UnitTests/ArchiveCatalogCountsTests.cs`
- `backend/tests/Gones.UnitTests/ArchiveAggregateTests.cs`

**Files modified:**

- `backend/src/Gones.Infrastructure/Persistence/GonesDbContext.cs` — one using, three DbSet properties.
- `backend/src/Gones.Infrastructure/Persistence/Migrations/GonesDbContextModelSnapshot.cs` — regenerated by the scaffold.

**Public API / behaviour change:** none observable over HTTP. No route added, changed or removed. The frontend is untouched, so `npm run api:check` stays green without regenerating the client. Three new tables exist and stay empty.

**Migrate / config:** one new EF migration, `RebuildArchiveThreeTier`, forward-only, additive. It creates three tables and touches no existing one, so it is safe to apply to a database already carrying `InitialCreate`. No new configuration key, no new environment variable.

## Validation

- [ ] `npm run backend:build` — exit `0`, zero warnings (`TreatWarningsAsErrors` is on, so a warning is a failure).
- [ ] `dotnet test backend/tests/Gones.UnitTests/Gones.UnitTests.csproj --configuration Release` — exit `0`. No Docker required. Expect `Passed!` with the three new classes' facts included.
- [ ] `npm run backend:test` — exit `0`, except possibly the single pre-existing failure `Gones.ArchitectureTests.MigrationSafetyTests.Rename_migrations_never_drop_or_recreate_the_table_they_rename` with the message `No committed migration renames a table; this guard is scanning nothing.` That one is T1 residue and is out of this fence; report it, do not fix it. Requires Docker for the Testcontainers-based integration suite.
- [ ] `MigrationSafetyTests.Committed_migrations_fully_describe_the_model` passes — proves the snapshot and the model agree, i.e. the migration really carries the three tables.
- [ ] Schema spot-check against a reset local database:
  ```bash
  npm run db:reset
  docker compose exec -T postgres psql -U gones_migration -d gones -c '\d archive_leagues' \
    -c '\d archive_league_seasons' -c '\d archive_tournaments'
  ```
  Expected: `document_id | text | not null` as the primary key of all three; `version | integer | not null`; `tournament_date | date | not null`; `document | jsonb | not null`; the five `ix_archive_*` indexes; the FK lines `league_id` → `archive_leagues(document_id)` and `season_id` → `archive_league_seasons(document_id)`.
- [ ] App functional — no broken path from this slice: with the stack running, `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5080/api/leagues-archive/all` returns `200`. The legacy archive surface is untouched and still serves.
- [ ] Manual check: none. This slice ships no UI and no CLI.
- [ ] `git status --short` lists only the files in *Outputs*.
- [ ] Commit msg draft: `feat(archive): add the three-tier archive schema and its aggregates`

