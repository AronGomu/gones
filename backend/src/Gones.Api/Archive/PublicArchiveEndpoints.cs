using System.Linq.Expressions;
using System.Security.Cryptography;
using System.Text;
using Gones.Domain.Archive;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Archive;

/// <summary>
/// The two whole-catalog public reads of the three-tier archive. The frontend list page downloads each
/// catalog once, caches it for a day and does its own paging, sorting and filtering, so both routes
/// serve summary rows projected in SQL rather than documents (ADR 0042).
/// </summary>
internal static class PublicArchiveEndpoints
{
    private const string CatalogCacheControl = "public, max-age=3600";
    private const string LogCategory = "Gones.Api.Archive";

    /// <summary>
    /// The League catalog ceiling. A League row is fixed width — five scalar fields, no document —
    /// so the cap exists to bound the body, not to bound the work.
    /// </summary>
    public const int MaximumLeagueCatalogSize = 2000;
    public const string MaximumLeagueCatalogSizeKey = "Gones:Archive:MaximumLeagueCatalogSize";

    /// <summary>The LeagueSeason catalog ceiling: more rows than Leagues, still fixed width.</summary>
    public const int MaximumSeasonCatalogSize = 5000;
    public const string MaximumSeasonCatalogSizeKey = "Gones:Archive:MaximumSeasonCatalogSize";

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

    private static IQueryable<ArchiveLeague> VisibleLeagues(GonesDbContext database) =>
        database.ArchiveLeagues.AsNoTracking().Where(league => league.DeletedAt == null);

    private static IQueryable<ArchiveLeagueSeason> VisibleSeasons(GonesDbContext database) =>
        database.ArchiveLeagueSeasons.AsNoTracking().Where(season => season.DeletedAt == null);

    /// <summary>
    /// The prologue both catalog routes share: the visible count, the ETag and the caching headers.
    ///
    /// <para><paramref name="representation"/> keeps the two bodies in separate ETag namespaces, so
    /// a client holding the League ETag can never be answered 304 and go on reading Seasons. The
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
    /// Both routes read one row past the ceiling, which is what tells a truncated catalog from an
    /// archive that ends exactly there. Drops the extra row and reports whether there was one.
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
