using System.Globalization;
using System.Linq.Expressions;
using System.Security.Cryptography;
using System.Text;
using Gones.Api.Errors;
using Gones.Application.Concurrency;
using Gones.Domain.Archive;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using NodaTime.Text;

namespace Gones.Api.Archive;

/// <summary>
/// The public reads of the three-tier archive. The frontend list page downloads each catalog once,
/// caches it and does its own paging, sorting and filtering, so every route here serves summary rows
/// projected in SQL rather than documents (ADR 0042).
///
/// <para>Leagues and LeagueSeasons come whole, one body each. Tournaments do not: the measured peak is
/// about 17,500 Tournaments in a single year, so a client that wanted last month would have paid for a
/// decade. Their unit of transfer, of caching and of revalidation is one calendar year, and
/// <c>/api/archive/years</c> is the index that says which years exist.</para>
///
/// <para>Beside the catalogs sit the four read-through routes the browser falls back to when its
/// IndexedDB year partitions cannot answer: one Season's Tournaments, one Tournament document, and
/// the two derived standings. The client renders the Season read-through and deliberately does not
/// cache it. Year partitions have exactly one writer — the backfill queue — and a partition is written
/// and stamped complete in a single IndexedDB transaction, so a year is atomically whole or absent;
/// caching this response would make a second writer and could leave a half-written year behind. A
/// detail document is never stored in a partition either: partitions hold summary rows.</para>
/// </summary>
internal static class PublicArchiveEndpoints
{
    private const string CatalogCacheControl = "public, max-age=3600";
    /// <summary>
    /// The read-through TTL. One minute rather than the catalogs' hour: a catalog is a whole table the
    /// client holds and revalidates, while these four bodies are what it reads when it is looking
    /// straight at a Tournament, and an hour-long HTTP cache would hide an edit behind a request that
    /// never reaches the server.
    /// </summary>
    private const string ReadThroughCacheControl = "public, max-age=60";
    private const string LogCategory = "Gones.Api.Archive";
    /// <summary>Postgres collation that orders text byte by byte, the way <c>StringComparer.Ordinal</c> does.</summary>
    private const string OrdinalCollation = "C";
    private const int MinimumYear = 1;
    private const int MaximumYear = 9999;

    /// <summary>
    /// The League catalog ceiling. A League row is fixed width — five scalar fields, no document —
    /// so the cap exists to bound the body, not to bound the work.
    /// </summary>
    public const int MaximumLeagueCatalogSize = 2000;
    public const string MaximumLeagueCatalogSizeKey = "Gones:Archive:MaximumLeagueCatalogSize";

    /// <summary>The LeagueSeason catalog ceiling: more rows than Leagues, still fixed width.</summary>
    public const int MaximumSeasonCatalogSize = 5000;
    public const string MaximumSeasonCatalogSizeKey = "Gones:Archive:MaximumSeasonCatalogSize";

    /// <summary>
    /// The Tournament year-partition ceiling. Far above the other two because it bounds one year of a
    /// table that grows without limit: the measured mtgtop8 peak is about 17,500 Tournaments in a
    /// single year, and this is that number plus headroom.
    /// </summary>
    public const int MaximumTournamentYearSize = 25_000;
    public const string MaximumTournamentYearSizeKey = "Gones:Archive:MaximumTournamentYearSize";

    /// <summary>
    /// The read-through ceiling for one Season's Tournaments. A Season is a bounded run of events
    /// rather than an unbounded table, so it sits with the Season catalog rather than with the year
    /// partition.
    /// </summary>
    public const int MaximumSeasonTournamentSize = 5000;
    public const string MaximumSeasonTournamentSizeKey = "Gones:Archive:MaximumSeasonTournamentSize";

    /// <summary>
    /// The batch size of the Season standings read. Not a ceiling: standings are computed from every
    /// document, so nothing here may truncate — the batch only bounds how many rows are resident at
    /// once. Frozen at the sibling row-list ceiling above.
    /// </summary>
    public const int SeasonResultBatchSize = 5000;
    public const string SeasonResultBatchSizeKey = "Gones:Archive:SeasonResultBatchSize";

    public static void MapPublicArchiveEndpoints(this WebApplication app)
    {
        app.MapGet("/api/archive/leagues/all", ListLeagueCatalogAsync)
            .AllowAnonymous()
            .WithName("GetArchiveLeagueCatalog")
            .Produces<ArchiveCatalogResponse<ArchiveLeagueSummary>>()
            .Produces(StatusCodes.Status304NotModified);
        app.MapGet("/api/archive/league-seasons/all", ListLeagueSeasonCatalogAsync)
            .AllowAnonymous()
            .WithName("GetArchiveLeagueSeasonCatalog")
            .Produces<ArchiveCatalogResponse<ArchiveLeagueSeasonSummary>>()
            .Produces(StatusCodes.Status304NotModified);
        // A literal segment always beats the sibling `/api/archive/tournaments/{tournamentId}` detail
        // template, so no registration ordering is needed between them.
        app.MapGet("/api/archive/tournaments/all", ListTournamentYearCatalogAsync)
            .AllowAnonymous()
            .WithName("GetArchiveTournamentYearCatalog")
            .Produces<ArchiveCatalogResponse<ArchiveTournamentSummary>>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status400BadRequest);
        app.MapGet("/api/archive/years", ListYearsAsync)
            .AllowAnonymous()
            .WithName("GetArchiveYears")
            .Produces<ArchiveYearsResponse>()
            .Produces(StatusCodes.Status304NotModified);
        app.MapGet("/api/archive/league-seasons/{seasonId}/tournaments", ListSeasonTournamentsAsync)
            .AllowAnonymous()
            .WithName("ArchiveSeasonTournaments")
            .Produces<ArchiveCatalogResponse<ArchiveTournamentSummary>>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound);
        app.MapGet("/api/archive/league-seasons/{seasonId}/result", GetSeasonResultAsync)
            .AllowAnonymous()
            .WithName("ArchiveSeasonResult")
            .Produces<LeagueResult>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound);
        app.MapGet("/api/archive/tournaments/{tournamentId}", GetTournamentAsync)
            .AllowAnonymous()
            .WithName("ArchiveTournamentDetail")
            .Produces<ArchiveTournamentDetailResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound);
        app.MapGet("/api/archive/tournaments/{tournamentId}/result", GetTournamentResultAsync)
            .AllowAnonymous()
            .WithName("ArchiveTournamentResult")
            .Produces<TournamentResult>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound);
    }

    /// <summary>
    /// Every League in one cacheable body. A League is a name and two timestamps — it has no page of
    /// its own, only a column and a filter on the Season table — so the row is projected straight out
    /// of Postgres and nothing is deserialized to answer this route (ADR 0042).
    /// </summary>
    private static async Task<IResult> ListLeagueCatalogAsync(
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var ceiling = configuration.GetValue(MaximumLeagueCatalogSizeKey, MaximumLeagueCatalogSize);
        var (total, notModified) = await PrepareCatalogAsync(
            VisibleLeagues(database),
            league => (Instant?)league.UpdatedAt,
            league => (long)league.Version,
            "archive-leagues",
            ceiling,
            CatalogCacheControl,
            request,
            response,
            cancellationToken);
        if (notModified) return Results.StatusCode(StatusCodes.Status304NotModified);

        var fetched = await VisibleLeagues(database)
            .OrderByDescending(league => league.UpdatedAt)
            .ThenBy(league => league.DocumentId)
            .Take(ceiling + 1)
            .Select(league => new ArchiveLeagueSummary(
                league.DocumentId,
                league.Name,
                league.CreatedAt,
                league.UpdatedAt,
                league.Version))
            .ToListAsync(cancellationToken);
        var truncated = CapToCeiling(fetched, ceiling, total, "leagues", loggerFactory);

        return Results.Ok(new ArchiveCatalogResponse<ArchiveLeagueSummary>(fetched, total, truncated));
    }

    /// <summary>
    /// Every LeagueSeason in one cacheable body. The four counters the Season table prints —
    /// <c>tournamentCount</c>, <c>playerCount</c> and the two boundary dates — are denormalized onto
    /// the row and recomputed inside the transaction of the Tournament write that changes them, so
    /// this route answers them without touching <c>archive_tournaments</c> and without deserializing
    /// a single Tournament document (ADR 0042).
    /// </summary>
    private static async Task<IResult> ListLeagueSeasonCatalogAsync(
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var ceiling = configuration.GetValue(MaximumSeasonCatalogSizeKey, MaximumSeasonCatalogSize);
        var (total, notModified) = await PrepareCatalogAsync(
            VisibleSeasons(database),
            season => (Instant?)season.UpdatedAt,
            season => (long)season.Version + season.CountsRevision,
            "archive-league-seasons",
            ceiling,
            CatalogCacheControl,
            request,
            response,
            cancellationToken);
        if (notModified) return Results.StatusCode(StatusCodes.Status304NotModified);

        var fetched = await VisibleSeasons(database)
            .OrderByDescending(season => season.UpdatedAt)
            .ThenBy(season => season.DocumentId)
            .Take(ceiling + 1)
            .Select(season => new ArchiveLeagueSeasonSummary(
                season.DocumentId,
                season.Name,
                season.LeagueId,
                season.Status,
                season.UpdatedAt,
                season.Version,
                season.TournamentCount,
                season.PlayerCount,
                season.FirstTournamentDate,
                season.LastTournamentDate))
            .ToListAsync(cancellationToken);
        var truncated = CapToCeiling(fetched, ceiling, total, "league-seasons", loggerFactory);

        return Results.Ok(new ArchiveCatalogResponse<ArchiveLeagueSeasonSummary>(fetched, total, truncated));
    }

    /// <summary>
    /// One calendar year of Tournaments. Each year carries its own ETag, derived from that year's rows
    /// alone, which is what lets a client revalidate the month it is looking at without invalidating
    /// the decade it already holds.
    /// </summary>
    private static async Task<IResult> ListTournamentYearCatalogAsync(
        string? year,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var requestedYear = ParseYear(year);
        var ceiling = configuration.GetValue(MaximumTournamentYearSizeKey, MaximumTournamentYearSize);
        var partition = VisibleTournamentsOfYear(database, requestedYear);
        // The year is inside the representation, so nothing about another year is hashed in and a write
        // in one year leaves every other year's ETag byte-identical. The current day deliberately is
        // not: no field of this body is derived from today, and putting the day in would expire every
        // partition nightly for nothing.
        var (total, notModified) = await PrepareCatalogAsync(
            partition,
            tournament => (Instant?)tournament.UpdatedAt,
            tournament => (long)tournament.Version,
            $"archive-tournaments-year:{requestedYear}",
            ceiling,
            CatalogCacheControl,
            request,
            response,
            cancellationToken);
        if (notModified) return Results.StatusCode(StatusCodes.Status304NotModified);

        // Projected to the columns first and shaped afterwards: LocalDatePattern has no SQL
        // translation, and the projection has to stay a plain column read so the jsonb document never
        // leaves the database.
        var fetched = await partition
            .OrderByDescending(tournament => tournament.TournamentDate)
            .ThenBy(tournament => EF.Functions.Collate(tournament.DocumentId, OrdinalCollation))
            .Take(ceiling + 1)
            .Select(tournament => new
            {
                tournament.DocumentId,
                tournament.Name,
                tournament.SeasonId,
                tournament.TournamentDate,
                tournament.Status,
                tournament.UpdatedAt,
                tournament.Version,
                tournament.PlayerCount
            })
            .ToListAsync(cancellationToken);
        var truncated = CapToCeiling(fetched, ceiling, total, $"tournaments-{requestedYear}", loggerFactory);
        var items = fetched
            .Select(tournament => new ArchiveTournamentSummary(
                tournament.DocumentId,
                tournament.Name,
                tournament.SeasonId,
                LocalDatePattern.Iso.Format(tournament.TournamentDate),
                tournament.Status,
                tournament.UpdatedAt,
                tournament.Version,
                tournament.PlayerCount))
            .ToList();

        return Results.Ok(new ArchiveCatalogResponse<ArchiveTournamentSummary>(items, total, truncated));
    }

    /// <summary>
    /// Which year partitions exist, how big each is, and whether it can still change. Not a capped
    /// catalog — it holds one row per year — so it stamps itself rather than going through
    /// <see cref="PrepareCatalogAsync"/>, whose ceiling decides a <c>truncated</c> flag this body does
    /// not have.
    /// </summary>
    private static async Task<IResult> ListYearsAsync(
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        IClock clock,
        CancellationToken cancellationToken)
    {
        var today = clock.GetCurrentInstant().InUtc().Date;
        var visible = VisibleTournaments(database);
        var total = await visible.CountAsync(cancellationToken);
        var newest = await visible.MaxAsync(tournament => (Instant?)tournament.UpdatedAt, cancellationToken);
        var weight = await visible.SumAsync(tournament => (long)tournament.Version, cancellationToken);
        // The day is part of what this body says: `locked` is derived from today, so without it a client
        // holding yesterday's ETag would be answered 304 against yesterday's flags and would go on
        // believing a year is still editable.
        var etag = HashETag($"{total}:{newest}:{weight}:archive-years:{LocalDatePattern.Iso.Format(today)}");
        response.Headers.ETag = etag;
        response.Headers.CacheControl = CatalogCacheControl;
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);

        var counts = await YearCountsQuery(database).ToListAsync(cancellationToken);
        var years = counts
            .Select(count => new ArchiveYearEntry(
                count.Year,
                // 31 December is the newest date a Tournament of that year can carry, so if that day is
                // locked every row in the year is.
                ArchiveLockRule.IsLocked(new LocalDate(count.Year, 12, 31), today),
                count.TournamentCount))
            .ToList();

        return Results.Ok(new ArchiveYearsResponse(years));
    }

    /// <summary>
    /// One Season's Tournaments, fetched straight through. This is the fallback a Season row expands to
    /// when the client's year partitions cannot cover it; the client renders the body and writes
    /// nothing, because the backfill queue is the only writer a partition may have.
    /// </summary>
    private static async Task<IResult> ListSeasonTournamentsAsync(
        string seasonId,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        ValidateRouteValue(seasonId, nameof(seasonId), ArchiveLeagueSeason.MaximumDocumentIdLength);
        // Existence is proven before anything is stamped, so an unknown Season answers 404 rather than a
        // cacheable empty page that looks exactly like a Season that simply holds nothing.
        await EnsureSeasonExistsAsync(database, seasonId, cancellationToken);
        var ceiling = configuration.GetValue(MaximumSeasonTournamentSizeKey, MaximumSeasonTournamentSize);
        var visible = VisibleTournamentsOfSeason(database, seasonId);
        var (total, notModified) = await PrepareCatalogAsync(
            visible,
            tournament => (Instant?)tournament.UpdatedAt,
            tournament => (long)tournament.Version,
            $"archive-season-tournaments:{seasonId}",
            ceiling,
            ReadThroughCacheControl,
            request,
            response,
            cancellationToken);
        if (notModified) return Results.StatusCode(StatusCodes.Status304NotModified);

        // Same slim projection as a year partition row, and for the same reason: the jsonb document
        // never leaves the database to answer a list. Shaped after the query because LocalDatePattern
        // has no SQL translation.
        var fetched = await visible
            .OrderByDescending(tournament => tournament.TournamentDate)
            .ThenBy(tournament => EF.Functions.Collate(tournament.DocumentId, OrdinalCollation))
            .Take(ceiling + 1)
            .Select(tournament => new
            {
                tournament.DocumentId,
                tournament.Name,
                tournament.SeasonId,
                tournament.TournamentDate,
                tournament.Status,
                tournament.UpdatedAt,
                tournament.Version,
                tournament.PlayerCount
            })
            .ToListAsync(cancellationToken);
        var truncated = CapToCeiling(fetched, ceiling, total, $"season-tournaments:{seasonId}", loggerFactory);
        var items = fetched
            .Select(tournament => new ArchiveTournamentSummary(
                tournament.DocumentId,
                tournament.Name,
                tournament.SeasonId,
                LocalDatePattern.Iso.Format(tournament.TournamentDate),
                tournament.Status,
                tournament.UpdatedAt,
                tournament.Version,
                tournament.PlayerCount))
            .ToList();

        return Results.Ok(new ArchiveCatalogResponse<ArchiveTournamentSummary>(items, total, truncated));
    }

    /// <summary>
    /// One Season's standings. The only Season route that reads the stored documents: standings are
    /// computed from Round entries, which the projected columns deliberately do not carry.
    /// </summary>
    private static async Task<IResult> GetSeasonResultAsync(
        string seasonId,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        ValidateRouteValue(seasonId, nameof(seasonId), ArchiveLeagueSeason.MaximumDocumentIdLength);
        _ = await LoadSeasonAsync(database, seasonId, cancellationToken);
        var visible = VisibleTournamentsOfSeason(database, seasonId);
        // A representation of its own, so a client holding the row-list ETag is never answered 304 and
        // left rendering a standings body it never received.
        var (_, etag) = await StampAsync(
            visible,
            tournament => (Instant?)tournament.UpdatedAt,
            tournament => (long)tournament.Version,
            $"archive-season-result:{seasonId}",
            cancellationToken);
        SetReadThroughCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);

        // The only route here that carries no ceiling, and it may never grow one: standings are summed
        // over every entry of every Tournament, so dropping documents answers wrong numbers rather than
        // fewer rows. The batch bounds what is resident at once, not what is counted — the keyset walk
        // below visits the whole Season, one page of documents at a time.
        var batchSize = Math.Max(1, configuration.GetValue(SeasonResultBatchSizeKey, SeasonResultBatchSize));
        var accumulator = new LeagueRules.LeagueResultAccumulator();
        LocalDate? lastDate = null;
        string? lastId = null;
        while (true)
        {
            var page = visible;
            // Strictly greater on the (date, id) pair the order is built from. `DocumentId` is the key,
            // so a pair never repeats and no document can be visited twice or skipped.
            if (lastDate is { } afterDate && lastId is { } afterId)
            {
                page = page.Where(tournament =>
                    tournament.TournamentDate > afterDate
                    || (tournament.TournamentDate == afterDate
                        && string.Compare(EF.Functions.Collate(tournament.DocumentId, OrdinalCollation), afterId) > 0));
            }
            var batch = await page
                .OrderBy(tournament => tournament.TournamentDate)
                .ThenBy(tournament => EF.Functions.Collate(tournament.DocumentId, OrdinalCollation))
                .Take(batchSize)
                .ToListAsync(cancellationToken);
            foreach (var tournament in batch)
                accumulator.Add(ArchiveDocumentAdapter.ToLegacyTournament(tournament.ReadDocument(), seasonId));
            // A full page cannot prove the walk is over, so a Season that is an exact multiple of the
            // batch pays one more query that comes back empty.
            if (batch.Count < batchSize) break;
            lastDate = batch[^1].TournamentDate;
            lastId = batch[^1].DocumentId;
        }

        // `League` now names the top tier, so a Season's standings must not label themselves one.
        return Results.Ok(accumulator.Build("season"));
    }

    /// <summary>
    /// The whole Tournament document. Never stored in a year partition — partitions hold summary rows —
    /// so this is the only route that serves Rounds and archetypes.
    /// </summary>
    private static async Task<IResult> GetTournamentAsync(
        string tournamentId,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var tournament = await LoadTournamentAsync(database, tournamentId, cancellationToken);
        // The row's own version rather than a hash, so this ETag is also the If-Match token an edit of
        // the Tournament the client just read needs.
        var etag = StrongETag.Encode(tournament.Version);
        SetReadThroughCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);

        var document = tournament.ReadDocument();
        return Results.Ok(new ArchiveTournamentDetailResponse(
            document.Id,
            document.Name,
            document.SeasonId,
            LocalDatePattern.Iso.Format(tournament.TournamentDate),
            document.Status,
            document.Rounds,
            document.PlayerArchetypes,
            tournament.Version,
            tournament.UpdatedAt));
    }

    /// <summary>One Tournament's standings, derived rather than stored.</summary>
    private static async Task<IResult> GetTournamentResultAsync(
        string tournamentId,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var tournament = await LoadTournamentAsync(database, tournamentId, cancellationToken);
        var etag = HashETag($"{tournament.Version}:archive-tournament-result:{tournamentId}");
        SetReadThroughCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);

        return Results.Ok(LeagueRules.CalculateTournamentResult(
            ArchiveDocumentAdapter.ToLegacyTournament(tournament.ReadDocument(), tournament.SeasonId ?? string.Empty)));
    }

    /// <summary>
    /// The years index as a GROUP BY. Exposed so a test can assert the aggregation happens in Postgres:
    /// counting in memory would mean loading every Tournament in the archive to answer a route the
    /// client calls on every session.
    /// </summary>
    internal static IQueryable<ArchiveYearCount> YearCountsQuery(GonesDbContext database) =>
        VisibleTournaments(database)
            .GroupBy(tournament => tournament.TournamentDate.Year)
            .OrderBy(group => group.Key)
            .Select(group => new ArchiveYearCount(group.Key, group.Count()));

    private static IQueryable<ArchiveLeague> VisibleLeagues(GonesDbContext database) =>
        database.ArchiveLeagues.AsNoTracking().Where(league => league.DeletedAt == null);

    private static IQueryable<ArchiveLeagueSeason> VisibleSeasons(GonesDbContext database) =>
        database.ArchiveLeagueSeasons.AsNoTracking().Where(season => season.DeletedAt == null);

    private static IQueryable<ArchiveTournament> VisibleTournaments(GonesDbContext database) =>
        database.ArchiveTournaments.AsNoTracking().Where(tournament => tournament.DeletedAt == null);

    /// <summary>
    /// A closed range on the stored column rather than <c>date_part('year', …) = year</c>, so
    /// <c>ix_archive_tournaments_tournament_date</c> stays usable.
    /// </summary>
    private static IQueryable<ArchiveTournament> VisibleTournamentsOfYear(GonesDbContext database, int year)
    {
        var firstDay = new LocalDate(year, 1, 1);
        var lastDay = new LocalDate(year, 12, 31);
        return VisibleTournaments(database)
            .Where(tournament => tournament.TournamentDate >= firstDay && tournament.TournamentDate <= lastDay);
    }

    /// <summary>
    /// The visible Tournaments of one Season, membership being <c>season_id = seasonId</c> exactly. A
    /// standalone Tournament carries <c>season_id IS NULL</c> and so belongs to no Season's read-through.
    /// </summary>
    private static IQueryable<ArchiveTournament> VisibleTournamentsOfSeason(GonesDbContext database, string seasonId) =>
        VisibleTournaments(database).Where(tournament => tournament.SeasonId == seasonId);

    /// <summary>Proves a Season is there without paying for its row: the read-through names none of its columns.</summary>
    private static async Task EnsureSeasonExistsAsync(GonesDbContext database, string seasonId, CancellationToken cancellationToken)
    {
        if (!await VisibleSeasons(database).AnyAsync(season => season.DocumentId == seasonId, cancellationToken))
            throw new ResourceNotFoundException();
    }

    private static async Task<ArchiveLeagueSeason> LoadSeasonAsync(GonesDbContext database, string seasonId, CancellationToken cancellationToken) =>
        await VisibleSeasons(database).SingleOrDefaultAsync(season => season.DocumentId == seasonId, cancellationToken)
            ?? throw new ResourceNotFoundException();

    private static async Task<ArchiveTournament> LoadTournamentAsync(GonesDbContext database, string tournamentId, CancellationToken cancellationToken)
    {
        ValidateRouteValue(tournamentId, nameof(tournamentId), ArchiveTournament.MaximumDocumentIdLength);
        return await VisibleTournaments(database).SingleOrDefaultAsync(tournament => tournament.DocumentId == tournamentId, cancellationToken)
            ?? throw new ResourceNotFoundException();
    }

    /// <summary>
    /// A malformed route id is a bad request, not a missing resource: answering 404 would tell the
    /// caller the id was merely unknown and invite a retry with the same broken value.
    /// </summary>
    private static void ValidateRouteValue(string value, string field, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > maximumLength)
        {
            throw new ApiValidationException(new Dictionary<string, string[]>
            {
                [field] = [$"Value must contain 1 to {maximumLength} characters."]
            });
        }
    }

    /// <summary>
    /// <paramref name="year"/> arrives as a string and is parsed here on purpose. Bound as an
    /// <c>int?</c>, minimal-API model binding would answer <c>?year=abc</c> with its own bare 400,
    /// which <c>UseStatusCodePages</c> labels <c>malformed_request</c> — a code that says nothing about
    /// which parameter was wrong. There is no all-years mode: a missing year is an error, not a
    /// request for the whole table.
    /// </summary>
    private static int ParseYear(string? year)
    {
        if (string.IsNullOrWhiteSpace(year))
            throw new ArchiveInvalidRequestException("Query parameter 'year' is required.");
        // NumberStyles.None rejects a sign, whitespace and group separators, so `-2031` and `2 031` fail
        // here rather than parsing into something the range check then has to catch.
        if (!int.TryParse(year.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var parsed)
            || parsed < MinimumYear
            || parsed > MaximumYear)
        {
            throw new ArchiveInvalidRequestException(
                $"Query parameter 'year' must be an integer between {MinimumYear} and {MaximumYear}.");
        }
        return parsed;
    }

    /// <summary>
    /// The prologue every capped catalog route shares: the visible count, the ETag and the caching
    /// headers.
    ///
    /// <para><paramref name="representation"/> keeps each body in its own ETag namespace, so a client
    /// holding the League ETag can never be answered 304 and go on reading Seasons, and a client
    /// holding one Tournament year can never be answered 304 for another. The
    /// ceiling is inside the input because it decides <c>truncated</c>: lowering the cap must
    /// invalidate a cached body whose flag would otherwise be wrong.</para>
    ///
    /// <para><paramref name="stampWeight"/> is the deviation from the League catalog's newest-row
    /// stamp, and it is load-bearing. A Season's counters are written by a <em>Tournament</em>
    /// command, and a Tournament moved between two Seasons that are neither of them the newest row
    /// leaves the newest row untouched — that archive would keep answering 304 with stale counters
    /// for the whole hour the body is cacheable. Every field it sums must therefore be strictly
    /// increasing per row: the counters themselves are not, and summing them hides exactly the write
    /// this stamp exists to catch, because the two <c>tournament_count</c> deltas of a move are equal
    /// and opposite and a re-dated Tournament moves no counter at all. Each row contributes its
    /// document version plus, where a derived column is written without one, its revision of that
    /// column.</para>
    /// </summary>
    private static async Task<(int Total, bool NotModified)> PrepareCatalogAsync<TEntity>(
        IQueryable<TEntity> visible,
        Expression<Func<TEntity, Instant?>> updatedAt,
        Expression<Func<TEntity, long>> stampWeight,
        string representation,
        int ceiling,
        string cacheControl,
        HttpRequest request,
        HttpResponse response,
        CancellationToken cancellationToken)
        where TEntity : class
    {
        var (total, etag) = await StampAsync(visible, updatedAt, stampWeight, $"{representation}:{ceiling}", cancellationToken);
        response.Headers.ETag = etag;
        response.Headers.CacheControl = cacheControl;
        return (total, IsNotModified(request, etag));
    }

    /// <summary>
    /// The count and the ETag over one visible set. Split out of <see cref="PrepareCatalogAsync"/> so
    /// the Season standings can share the same stamp without inheriting a ceiling: that ceiling decides
    /// a <c>truncated</c> flag a standings body does not have, and a second copy of this formula is how
    /// two routes end up disagreeing about when a cached body went stale.
    /// </summary>
    private static async Task<(int Total, string ETag)> StampAsync<TEntity>(
        IQueryable<TEntity> visible,
        Expression<Func<TEntity, Instant?>> updatedAt,
        Expression<Func<TEntity, long>> stampWeight,
        string representation,
        CancellationToken cancellationToken)
        where TEntity : class
    {
        var total = await visible.CountAsync(cancellationToken);
        var newest = await visible.MaxAsync(updatedAt, cancellationToken);
        var weight = await visible.SumAsync(stampWeight, cancellationToken);
        return (total, HashETag($"{total}:{newest}:{weight}:{representation}"));
    }

    /// <summary>
    /// Every capped route reads one row past the ceiling, which is what tells a truncated catalog from
    /// an archive that ends exactly there. Drops the extra row and reports whether there was one.
    /// </summary>
    private static bool CapToCeiling<T>(List<T> fetched, int ceiling, int total, string catalog, ILoggerFactory loggerFactory)
    {
        if (fetched.Count <= ceiling) return false;
        fetched.RemoveRange(ceiling, fetched.Count - ceiling);
        loggerFactory.CreateLogger(LogCategory)
            .LogWarning("Public archive catalog truncated: catalog={Catalog} total={Total} ceiling={Ceiling}", catalog, total, ceiling);
        return true;
    }

    // Its own copy rather than a call into the legacy archive endpoints: those were deleted with that
    // surface, and this header contract had to survive them.
    private static void SetReadThroughCache(HttpResponse response, string etag)
    {
        response.Headers.ETag = etag;
        response.Headers.CacheControl = ReadThroughCacheControl;
    }

    private static bool IsNotModified(HttpRequest request, string etag) =>
        request.Headers.IfNoneMatch.Any(value => string.Equals(value, etag, StringComparison.Ordinal));

    private static string HashETag(string value) =>
        $"\"{Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)))}\"";
}

/// <summary>
/// The envelope every whole-catalog archive read answers: the rows, the size of the whole visible
/// table, and whether the row cap cut the list short.
/// </summary>
internal sealed record ArchiveCatalogResponse<TItem>(
    IReadOnlyList<TItem> Items,
    int TotalCount,
    bool Truncated);

/// <summary>A League catalog row: the top tier has no page of its own, only a column and a filter.</summary>
internal sealed record ArchiveLeagueSummary(
    string Id,
    string Name,
    Instant CreatedAt,
    Instant UpdatedAt,
    int DocumentVersion);

/// <summary>
/// A LeagueSeason catalog row: everything the Season table prints, and nothing else. The four
/// counters are read straight off the denormalized columns, so no Tournament is touched (ADR 0042).
/// </summary>
internal sealed record ArchiveLeagueSeasonSummary(
    string Id,
    string Name,
    string LeagueId,
    string Status,
    Instant UpdatedAt,
    int DocumentVersion,
    int TournamentCount,
    int PlayerCount,
    LocalDate? FirstTournamentDate,
    LocalDate? LastTournamentDate);
