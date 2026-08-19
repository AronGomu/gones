using System.Globalization;
using System.Linq.Expressions;
using System.Security.Cryptography;
using System.Text;
using Gones.Api.Errors;
using Gones.Application.Concurrency;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;
using NodaTime;

namespace Gones.Api.Leagues;

internal static class PublicLeagueEndpoints
{
    public const int DefaultPageSize = 20;
    public const int MaximumPageSize = 100;
    private const int MaximumSearchLength = 200;
    internal const int MaximumPlayerNameLength = 200;
    private const string AppVersion = "0.1.0";
    private const string PublicCacheControl = "public, max-age=60";
    private const string CatalogCacheControl = "public, max-age=3600";
    /// <summary>Postgres collation that orders text byte by byte, the way <c>StringComparer.Ordinal</c> does.</summary>
    internal const string OrdinalCollation = "C";

    /// <summary>
    /// The League catalog ceiling. It is far below the 5000 rows the rankings catalog allows because a
    /// League is a whole document of up to <see cref="LeagueArchiveAggregate.MaximumDocumentBytes"/>,
    /// not a fixed-width row.
    /// </summary>
    public const int MaximumCatalogSize = 1000;
    public const string MaximumCatalogSizeKey = "Gones:Leagues:MaximumCatalogSize";

    private static readonly int[] GlobalStatsAllowedPageSizes = [10, 25, 50, 100];
    private const int GlobalStatsDefaultPageSize = 100;
    public const int GlobalStatsMaximumCatalogSize = 5000;
    public const string GlobalStatsMaximumCatalogSizeKey = "Gones:GlobalStats:MaximumCatalogSize";
    private static readonly HashSet<string> GlobalStatsSortAllowlist = new(StringComparer.Ordinal)
    {
        "playedMatchCount", "matchWins", "matchLosses", "matchDraws", "matchWinrate",
        "playedGameCount", "gameWins", "gameLosses", "gameWinrate"
    };

    public static void MapPublicLeagueEndpoints(this WebApplication app)
    {
        app.MapGet("/api/leagues-archive/global-player-statistics", GetGlobalPlayerStatisticsAsync)
            .AllowAnonymous()
            .WithName("GetGlobalPlayerStatistics")
            .Produces<GlobalPlayerStatisticsResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status400BadRequest);
        app.MapGet("/api/leagues-archive/global-player-statistics/all", GetGlobalPlayerStatisticsCatalogAsync)
            .AllowAnonymous()
            .WithName("GetGlobalPlayerStatisticsCatalog")
            .Produces<GlobalPlayerStatisticsCatalogResponse>()
            .Produces(StatusCodes.Status304NotModified);
        app.MapGet("/api/leagues-archive", ListAsync)
            .AllowAnonymous()
            .Produces<PublicLeagueListResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status400BadRequest);
        app.MapGet("/api/leagues-archive/all", ListCatalogAsync)
            .AllowAnonymous()
            .Produces<PublicLeagueCatalogResponse>()
            .Produces(StatusCodes.Status304NotModified);
        app.MapGet("/api/leagues-archive/{id}", GetAsync)
            .AllowAnonymous()
            .Produces<PublicLeagueDetailResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound);
        app.MapGet("/api/leagues-archive/{id}/result", GetLeagueResultAsync)
            .AllowAnonymous()
            .Produces<LeagueResult>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status404NotFound);
        app.MapGet("/api/leagues-archive/{id}/tournaments-archive/{tournamentId}", GetTournamentAsync)
            .AllowAnonymous()
            .Produces<TournamentDocument>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status404NotFound);
        app.MapGet("/api/leagues-archive/{id}/tournaments-archive/{tournamentId}/result", GetTournamentResultAsync)
            .AllowAnonymous()
            .Produces<TournamentResult>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status404NotFound);
        app.MapGet("/api/leagues-archive/{id}/players/{playerName}/statistics", GetPlayerStatisticsAsync)
            .AllowAnonymous()
            .Produces<PlayerStatistics>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound);
        app.MapGet("/api/leagues-archive/{id}/export", ExportLeagueAsync)
            .AllowAnonymous()
            .Produces<LeagueExportResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status404NotFound);
    }

    private static async Task<IResult> GetGlobalPlayerStatisticsAsync(
        int? page,
        int? pageSize,
        string? search,
        string? sort,
        string? direction,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var pageNumber = page ?? 1;
        var size = pageSize ?? GlobalStatsDefaultPageSize;
        if (pageNumber < 1) throw Validation("page", "Page must be at least 1.");
        if (!GlobalStatsAllowedPageSizes.Contains(size)) throw Validation("pageSize", "Page size must be 10, 25, 50, or 100.");
        if (search?.Length > MaximumSearchLength) throw Validation("search", $"Search must be at most {MaximumSearchLength} characters.");
        if (sort is not null && !GlobalStatsSortAllowlist.Contains(sort)) throw Validation("sort", "Sort column is not valid.");
        if (direction is not null && direction is not ("asc" or "desc")) throw Validation("direction", "Direction must be asc or desc.");

        // ADR 0040: the numbers come from the materialized read model, so Postgres does the filtering,
        // the ordering and the paging. Nothing on this path reads a League document any more.
        var query = FilterGlobalStats(database.PlayerStatistics.AsNoTracking(), search);
        var total = await query.CountAsync(cancellationToken);

        var normalizedQuery = $"sort={sort}&dir={direction}&search={search?.Trim() ?? string.Empty}&page={pageNumber}&size={size}";
        var etag = HashETag($"{await ReadModelStampAsync(database, cancellationToken)}:{total}:{normalizedQuery}");
        SetPublicCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);

        var isDescending = !string.Equals(direction, "asc", StringComparison.Ordinal);
        var offset = (pageNumber - 1) * size;
        var rows = await OrderGlobalStats(query, sort, isDescending)
            .Skip(offset)
            .Take(size)
            .ToListAsync(cancellationToken);
        var items = rows.Select((row, index) => ToGlobalStatsRow(offset + index + 1, row)).ToList();

        return Results.Ok(new GlobalPlayerStatisticsResponse(items, pageNumber, size, total, sort, direction));
    }

    /// <summary>
    /// The whole read model in one cacheable body, the rankings twin of <c>/api/events/all</c>: a
    /// read-mostly public page filters and sorts it in the browser instead of paying a round trip per
    /// interaction.
    /// </summary>
    private static async Task<IResult> GetGlobalPlayerStatisticsCatalogAsync(
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var ceiling = configuration.GetValue(GlobalStatsMaximumCatalogSizeKey, GlobalStatsMaximumCatalogSize);
        var total = await database.PlayerStatistics.AsNoTracking().CountAsync(cancellationToken);
        var etag = HashETag($"{await ReadModelStampAsync(database, cancellationToken)}:{total}:catalog:{ceiling}");
        response.Headers.ETag = etag;
        response.Headers.CacheControl = CatalogCacheControl;
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);

        // One row past the ceiling is what tells a truncated catalog from a table that ends exactly there.
        var fetched = await database.PlayerStatistics.AsNoTracking()
            .OrderByDescending(row => row.PlayedMatchCount)
            .ThenBy(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation))
            .Take(ceiling + 1)
            .ToListAsync(cancellationToken);
        var truncated = fetched.Count > ceiling;
        var items = (truncated ? fetched.Take(ceiling) : fetched)
            .Select((row, index) => ToGlobalStatsRow(index + 1, row))
            .ToList();
        if (truncated)
        {
            loggerFactory.CreateLogger("Gones.Api.Leagues")
                .LogWarning("Public player statistics catalog truncated: total={Total} ceiling={Ceiling}", total, ceiling);
        }

        return Results.Ok(new GlobalPlayerStatisticsCatalogResponse(items, total, truncated));
    }

    private static IQueryable<PlayerStatisticsRow> FilterGlobalStats(IQueryable<PlayerStatisticsRow> query, string? search)
    {
        if (string.IsNullOrWhiteSpace(search)) return query;
        var term = EscapeLikePattern(search.Trim());
        return query.Where(row => EF.Functions.ILike(row.PlayerName, $"%{term}%", "\\"));
    }

    /// <summary>
    /// The ordering the in-memory computation used, expressed so Postgres can serve it from the
    /// per-column indexes. Two details are load-bearing: the Player Name tiebreak collates as <c>C</c>
    /// because Player Names are exact and case-sensitive (ADR 0040) while the database collation is
    /// not, and a null winrate sorts last in both directions instead of taking Postgres' own null
    /// placement, which flips with the direction.
    /// </summary>
    private static IQueryable<PlayerStatisticsRow> OrderGlobalStats(IQueryable<PlayerStatisticsRow> query, string? sort, bool descending)
    {
        if (sort is null)
            return query
                .OrderByDescending(row => row.MatchWins)
                .ThenByDescending(row => row.GameWins)
                .ThenByDescending(row => row.MatchDraws)
                .ThenBy(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation));
        return sort switch
        {
            "playedMatchCount" => GlobalSortByCount(query, row => row.PlayedMatchCount, descending),
            "matchWins" => GlobalSortByCount(query, row => row.MatchWins, descending),
            "matchLosses" => GlobalSortByCount(query, row => row.MatchLosses, descending),
            "matchDraws" => GlobalSortByCount(query, row => row.MatchDraws, descending),
            "matchWinrate" => GlobalSortByWinrate(query, row => row.MatchWinrate, row => row.MatchWinrate == null, descending),
            "playedGameCount" => GlobalSortByCount(query, row => row.PlayedGameCount, descending),
            "gameWins" => GlobalSortByCount(query, row => row.GameWins, descending),
            "gameLosses" => GlobalSortByCount(query, row => row.GameLosses, descending),
            "gameWinrate" => GlobalSortByWinrate(query, row => row.GameWinrate, row => row.GameWinrate == null, descending),
            _ => throw new InvalidOperationException($"Unknown sort: {sort}")
        };
    }

    private static IQueryable<PlayerStatisticsRow> GlobalSortByCount(
        IQueryable<PlayerStatisticsRow> query,
        Expression<Func<PlayerStatisticsRow, int>> column,
        bool descending) =>
        (descending ? query.OrderByDescending(column) : query.OrderBy(column))
            .ThenBy(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation));

    private static IQueryable<PlayerStatisticsRow> GlobalSortByWinrate(
        IQueryable<PlayerStatisticsRow> query,
        Expression<Func<PlayerStatisticsRow, double?>> column,
        Expression<Func<PlayerStatisticsRow, bool>> missing,
        bool descending)
    {
        var nullsLast = query.OrderBy(missing);
        return (descending ? nullsLast.ThenByDescending(column) : nullsLast.ThenBy(column))
            .ThenBy(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation));
    }

    private static GlobalPlayerStatisticsRow ToGlobalStatsRow(int position, PlayerStatisticsRow row) => new(
        position,
        row.PlayerName,
        row.PlayedMatchCount,
        row.MatchWins,
        row.MatchLosses,
        row.MatchDraws,
        row.MatchWinrate,
        row.PlayedGameCount,
        row.GameWins,
        row.GameLosses,
        row.GameWinrate,
        row.Nemesis,
        row.Rival,
        row.MostPlayedArchetype);

    /// <summary>
    /// When the read model last changed, as the ETag input that replaces the scan over every archive
    /// aggregate. <c>PlayerStatisticsRebuildService</c> moves the stamp inside the transaction of every
    /// rebuild, so a conditional request cannot be answered 304 against numbers that have since moved.
    /// </summary>
    internal static async Task<string> ReadModelStampAsync(GonesDbContext database, CancellationToken cancellationToken)
    {
        var rebuiltAt = await database.PlayerStatisticsMeta.AsNoTracking()
            .Select(meta => (Instant?)meta.RebuiltAt)
            .SingleOrDefaultAsync(cancellationToken);
        return rebuiltAt?.ToUnixTimeTicks().ToString(CultureInfo.InvariantCulture) ?? "unbuilt";
    }

    private static async Task<IResult> ListAsync(
        int? page,
        int? pageSize,
        string? status,
        string? search,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var pageNumber = page ?? 1;
        var size = pageSize ?? DefaultPageSize;
        if (pageNumber < 1) throw Validation("page", "Page must be at least 1.");
        if (size is < 1 or > MaximumPageSize) throw Validation("pageSize", $"Page size must be between 1 and {MaximumPageSize}.");
        if (search?.Length > MaximumSearchLength) throw Validation("search", $"Search must be at most {MaximumSearchLength} characters.");
        if (status is not null && status is not ("active" or "completed")) throw Validation("status", "Status must be active or completed.");

        var query = database.LeagueArchiveAggregates.AsNoTracking().Where(aggregate => aggregate.DeletedAt == null);
        if (status is not null) query = query.Where(aggregate => aggregate.Status == status);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = EscapeLikePattern(search.Trim());
            query = query.Where(aggregate => EF.Functions.ILike(aggregate.Name, $"%{term}%", "\\"));
        }

        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderByDescending(aggregate => aggregate.UpdatedAt)
            .ThenBy(aggregate => aggregate.Id)
            .Skip((pageNumber - 1) * size)
            .Take(size)
            .Select(aggregate => new PublicLeagueSummaryResponse(
                aggregate.DocumentId,
                aggregate.Name,
                aggregate.Status,
                aggregate.UpdatedAt,
                aggregate.Version))
            .ToListAsync(cancellationToken);
        var etag = HashETag($"{total}:{pageNumber}:{size}:{status}:{search}:{string.Join('|', items.Select(item => $"{item.Id}:{item.DocumentVersion}:{item.UpdatedAt.ToUnixTimeTicks()}"))}");
        SetPublicCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);
        return Results.Ok(new PublicLeagueListResponse(items, pageNumber, size, total));
    }

    /// <summary>
    /// The whole archive in one cacheable body, the League twin of <c>/api/events/all</c> (ADR 0039).
    /// Without it the list page had to read the paged summaries and then one detail per League, which
    /// on a large archive is hundreds of requests for one navigation and trips the public read limiter.
    /// The summary rows carry neither the Tournaments nor the players the cards count, so paging alone
    /// cannot answer that page — the documents themselves have to come down.
    /// </summary>
    private static async Task<IResult> ListCatalogAsync(
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var ceiling = configuration.GetValue(MaximumCatalogSizeKey, MaximumCatalogSize);
        var query = database.LeagueArchiveAggregates.AsNoTracking().Where(aggregate => aggregate.DeletedAt == null);
        var total = await query.CountAsync(cancellationToken);
        // Every write bumps `UpdatedAt` to now, so the newest row plus the count identifies the archive:
        // an edit moves the stamp, a create or a soft delete moves the count.
        var stamp = await query
            .OrderByDescending(aggregate => aggregate.UpdatedAt)
            .ThenBy(aggregate => aggregate.Id)
            .Select(aggregate => new { aggregate.UpdatedAt, aggregate.DocumentId, aggregate.Version })
            .FirstOrDefaultAsync(cancellationToken);
        var etag = HashETag($"{total}:{stamp?.UpdatedAt}:{stamp?.DocumentId}:{stamp?.Version}:catalog:{ceiling}");
        response.Headers.ETag = etag;
        response.Headers.CacheControl = CatalogCacheControl;
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);

        // One row past the ceiling is what tells a truncated catalog from an archive that ends exactly there.
        var fetched = await query
            .OrderByDescending(aggregate => aggregate.UpdatedAt)
            .ThenBy(aggregate => aggregate.Id)
            .Take(ceiling + 1)
            .ToListAsync(cancellationToken);
        var truncated = fetched.Count > ceiling;
        var items = (truncated ? fetched.Take(ceiling) : fetched).Select(ToDetail).ToList();
        if (truncated)
        {
            loggerFactory.CreateLogger("Gones.Api.Leagues")
                .LogWarning("Public League catalog truncated: total={Total} ceiling={Ceiling}", total, ceiling);
        }

        return Results.Ok(new PublicLeagueCatalogResponse(items, total, truncated));
    }

    private static async Task<IResult> GetAsync(
        string id,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var aggregate = await LoadAsync(id, database, cancellationToken);
        var etag = StrongETag.Encode(aggregate.Version);
        SetPublicCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);
        return Results.Ok(ToDetail(aggregate));
    }

    private static PublicLeagueDetailResponse ToDetail(LeagueArchiveAggregate aggregate)
    {
        var document = aggregate.ReadDocument();
        return new PublicLeagueDetailResponse(
            document.Id,
            document.Name,
            document.Status,
            document.Tournaments,
            aggregate.Version,
            aggregate.UpdatedAt);
    }

    private static async Task<IResult> GetLeagueResultAsync(
        string id,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var aggregate = await LoadAsync(id, database, cancellationToken);
        return Derived(request, response, aggregate, "league-result", LeagueRules.CalculateLeagueResult(aggregate.ReadDocument()));
    }

    private static async Task<IResult> GetTournamentAsync(
        string id,
        string tournamentId,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        ValidateRouteValue(tournamentId, nameof(tournamentId));
        var aggregate = await LoadAsync(id, database, cancellationToken);
        var tournament = FindTournament(aggregate.ReadDocument(), tournamentId);
        return Derived(request, response, aggregate, $"tournament:{tournamentId}", tournament);
    }

    private static async Task<IResult> GetTournamentResultAsync(
        string id,
        string tournamentId,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        ValidateRouteValue(tournamentId, nameof(tournamentId));
        var aggregate = await LoadAsync(id, database, cancellationToken);
        var tournament = FindTournament(aggregate.ReadDocument(), tournamentId);
        return Derived(request, response, aggregate, $"tournament-result:{tournamentId}", LeagueRules.CalculateTournamentResult(tournament));
    }

    private static async Task<IResult> GetPlayerStatisticsAsync(
        string id,
        string playerName,
        string? tournamentId,
        string? opponentName,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        ValidateRouteValue(playerName, nameof(playerName), MaximumPlayerNameLength);
        if (tournamentId is not null) ValidateRouteValue(tournamentId, nameof(tournamentId));
        if (opponentName?.Length > MaximumPlayerNameLength)
            throw Validation(nameof(opponentName), $"Opponent name must be at most {MaximumPlayerNameLength} characters.");
        var aggregate = await LoadAsync(id, database, cancellationToken);
        var document = aggregate.ReadDocument();
        var data = new GonesData(LeagueNormalizer.GonesDataVersion, [document], []);
        var filters = new PlayerStatisticsFilters(id, tournamentId, opponentName);
        var statistics = LeagueRules.CalculatePlayerStatistics(data, playerName, filters);
        return Derived(request, response, aggregate, $"player-statistics:{playerName}:{tournamentId}:{opponentName}", statistics);
    }

    private static async Task<IResult> ExportLeagueAsync(
        string id,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var aggregate = await LoadAsync(id, database, cancellationToken);
        var etag = StrongETag.Encode(aggregate.Version);
        SetPublicCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);
        var document = aggregate.ReadDocument();
        response.Headers.ContentDisposition = new ContentDispositionHeaderValue("attachment")
        {
            FileNameStar = $"{aggregate.UpdatedAt.ToDateTimeUtc():yyyy-MM-dd} {SafeFilename(document.Name)}.json"
        }.ToString();
        return Results.Ok(new LeagueExportResponse(
            "league",
            LeagueNormalizer.GonesDataVersion,
            AppVersion,
            aggregate.UpdatedAt,
            document));
    }

    private static IResult Derived<T>(HttpRequest request, HttpResponse response, LeagueArchiveAggregate aggregate, string representation, T value)
    {
        var etag = HashETag($"{aggregate.Version}:{representation}");
        SetPublicCache(response, etag);
        return IsNotModified(request, etag) ? Results.StatusCode(StatusCodes.Status304NotModified) : Results.Ok(value);
    }

    private static async Task<LeagueArchiveAggregate> LoadAsync(string id, GonesDbContext database, CancellationToken cancellationToken)
    {
        ValidateRouteValue(id, nameof(id));
        return await database.LeagueArchiveAggregates.AsNoTracking()
            .SingleOrDefaultAsync(aggregate => aggregate.DocumentId == id && aggregate.DeletedAt == null, cancellationToken)
            ?? throw new ResourceNotFoundException();
    }

    private static TournamentDocument FindTournament(LeagueDocument league, string tournamentId) =>
        league.Tournaments.SingleOrDefault(tournament => tournament.Id == tournamentId)
        ?? throw new ResourceNotFoundException();

    private static void ValidateRouteValue(string value, string field, int maximumLength = LeagueArchiveAggregate.MaximumDocumentIdLength)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > maximumLength)
            throw Validation(field, $"Value must contain 1 to {maximumLength} characters.");
    }

    internal static string EscapeLikePattern(string value) =>
        value.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("%", "\\%", StringComparison.Ordinal)
            .Replace("_", "\\_", StringComparison.Ordinal);

    private static string SafeFilename(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var sanitized = new string(value.Select(character => invalid.Contains(character) || char.IsControl(character) ? '_' : character).ToArray()).Trim();
        return sanitized.Length == 0 ? "League" : sanitized;
    }

    private static void SetPublicCache(HttpResponse response, string etag)
    {
        response.Headers.ETag = etag;
        response.Headers.CacheControl = PublicCacheControl;
    }

    internal static bool IsNotModified(HttpRequest request, string etag) =>
        request.Headers.IfNoneMatch.Any(value => string.Equals(value, etag, StringComparison.Ordinal));

    internal static string HashETag(string value) =>
        $"\"{Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)))}\"";

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });
}

internal sealed record PublicLeagueListResponse(
    IReadOnlyList<PublicLeagueSummaryResponse> Items,
    int Page,
    int PageSize,
    int TotalCount);

internal sealed record PublicLeagueSummaryResponse(
    string Id,
    string Name,
    string Status,
    Instant UpdatedAt,
    long DocumentVersion);

internal sealed record PublicLeagueDetailResponse(
    string Id,
    string Name,
    string Status,
    IReadOnlyList<TournamentDocument> Tournaments,
    long DocumentVersion,
    Instant UpdatedAt);

internal sealed record PublicLeagueCatalogResponse(
    IReadOnlyList<PublicLeagueDetailResponse> Items,
    int TotalCount,
    bool Truncated);

internal sealed record GlobalPlayerStatisticsResponse(
    IReadOnlyList<GlobalPlayerStatisticsRow> Items,
    int Page,
    int PageSize,
    int TotalCount,
    string? Sort,
    string? Direction);

internal sealed record GlobalPlayerStatisticsCatalogResponse(
    IReadOnlyList<GlobalPlayerStatisticsRow> Items,
    int TotalCount,
    bool Truncated);

internal sealed record GlobalPlayerStatisticsRow(
    int Position,
    string PlayerName,
    int PlayedMatchCount,
    int MatchWins,
    int MatchLosses,
    int MatchDraws,
    double? MatchWinrate,
    int PlayedGameCount,
    int GameWins,
    int GameLosses,
    double? GameWinrate,
    OpponentRecord? Nemesis,
    OpponentRecord? Rival,
    PlayerArchetypeUsage? MostPlayedArchetype);

internal sealed record LeagueExportResponse(
    string Kind,
    int GonesDataVersion,
    string GonesAppVersion,
    Instant ExportedAt,
    LeagueDocument League);
