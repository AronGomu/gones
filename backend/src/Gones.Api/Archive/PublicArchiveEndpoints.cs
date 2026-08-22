using System.Globalization;
using System.Linq.Expressions;
using System.Security.Cryptography;
using System.Text;
using Gones.Api.Errors;
using Gones.Domain.Archive;
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
/// </summary>
internal static class PublicArchiveEndpoints
{
    private const string CatalogCacheControl = "public, max-age=3600";
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
            season => (long)season.Version + season.TournamentCount + season.PlayerCount + season.CountsVersion,
            "archive-league-seasons",
            ceiling,
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
    /// for the whole hour the body is cacheable. Summing a strictly increasing per-row version plus
    /// the counters themselves moves on every write to any row.</para>
    /// </summary>
    private static async Task<(int Total, bool NotModified)> PrepareCatalogAsync<TEntity>(
        IQueryable<TEntity> visible,
        Expression<Func<TEntity, Instant?>> updatedAt,
        Expression<Func<TEntity, long>> stampWeight,
        string representation,
        int ceiling,
        HttpRequest request,
        HttpResponse response,
        CancellationToken cancellationToken)
        where TEntity : class
    {
        var total = await visible.CountAsync(cancellationToken);
        var newest = await visible.MaxAsync(updatedAt, cancellationToken);
        var weight = await visible.SumAsync(stampWeight, cancellationToken);
        var etag = HashETag($"{total}:{newest}:{weight}:{representation}:{ceiling}");
        response.Headers.ETag = etag;
        response.Headers.CacheControl = CatalogCacheControl;
        return (total, IsNotModified(request, etag));
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

    // Copies rather than calls into PublicLeagueEndpoints: that file is deleted when the legacy
    // /api/leagues-archive surface retires, and this one has to survive it.
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
