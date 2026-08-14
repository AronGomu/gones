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
    private const int MaximumPlayerNameLength = 200;
    private const string AppVersion = "0.1.0";
    private const string PublicCacheControl = "public, max-age=60";

    private static readonly int[] GlobalStatsAllowedPageSizes = [10, 25, 50, 100];
    private const int GlobalStatsDefaultPageSize = 100;
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
        app.MapGet("/api/leagues-archive", ListAsync)
            .AllowAnonymous()
            .Produces<PublicLeagueListResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status400BadRequest);
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

        var aggregates = await database.LeagueArchiveAggregates.AsNoTracking()
            .Where(a => a.DeletedAt == null && a.Status == "completed")
            .ToListAsync(cancellationToken);

        var data = new GonesData(LeagueNormalizer.GonesDataVersion,
            aggregates.Select(a => a.ReadDocument()).ToList(), []);
        var allRows = LeagueRules.CalculateGlobalPlayerStatistics(data);

        IReadOnlyList<GlobalPlayerStatistics> filtered;
        if (string.IsNullOrWhiteSpace(search))
        {
            filtered = allRows;
        }
        else
        {
            var term = search.Trim().ToLower(System.Globalization.CultureInfo.GetCultureInfo("en-US"));
            filtered = allRows
                .Where(r => r.PlayerName.ToLower(System.Globalization.CultureInfo.GetCultureInfo("en-US")).Contains(term, StringComparison.Ordinal))
                .ToArray();
        }

        var isDescending = !string.Equals(direction, "asc", StringComparison.Ordinal);
        var sorted = ApplyGlobalSort(filtered, sort, isDescending);
        var total = sorted.Count;

        var items = sorted
            .Skip((pageNumber - 1) * size)
            .Take(size)
            .Select((row, index) => new GlobalPlayerStatisticsRow(
                (pageNumber - 1) * size + index + 1,
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
                row.MostPlayedArchetype))
            .ToList();

        var aggregateKey = string.Join('|', aggregates
            .OrderBy(a => a.DocumentId, StringComparer.Ordinal)
            .Select(a => $"{a.DocumentId}:{a.Version}"));
        var normalizedQuery = $"sort={sort}&dir={direction}&search={search?.Trim() ?? string.Empty}&page={pageNumber}&size={size}";
        var etag = HashETag($"{aggregateKey}:{normalizedQuery}");
        SetPublicCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);

        return Results.Ok(new GlobalPlayerStatisticsResponse(items, pageNumber, size, total, sort, direction));
    }

    private static IReadOnlyList<GlobalPlayerStatistics> ApplyGlobalSort(
        IReadOnlyList<GlobalPlayerStatistics> rows,
        string? sort,
        bool descending)
    {
        if (sort is null)
            return rows
                .OrderByDescending(r => r.MatchWins)
                .ThenByDescending(r => r.GameWins)
                .ThenByDescending(r => r.MatchDraws)
                .ThenBy(r => r.PlayerName, StringComparer.Ordinal)
                .ToArray();
        return sort switch
        {
            "playedMatchCount" => descending
                ? rows.OrderByDescending(r => r.PlayedMatchCount).ThenBy(r => r.PlayerName, StringComparer.Ordinal).ToArray()
                : rows.OrderBy(r => r.PlayedMatchCount).ThenBy(r => r.PlayerName, StringComparer.Ordinal).ToArray(),
            "matchWins" => descending
                ? rows.OrderByDescending(r => r.MatchWins).ThenBy(r => r.PlayerName, StringComparer.Ordinal).ToArray()
                : rows.OrderBy(r => r.MatchWins).ThenBy(r => r.PlayerName, StringComparer.Ordinal).ToArray(),
            "matchLosses" => descending
                ? rows.OrderByDescending(r => r.MatchLosses).ThenBy(r => r.PlayerName, StringComparer.Ordinal).ToArray()
                : rows.OrderBy(r => r.MatchLosses).ThenBy(r => r.PlayerName, StringComparer.Ordinal).ToArray(),
            "matchDraws" => descending
                ? rows.OrderByDescending(r => r.MatchDraws).ThenBy(r => r.PlayerName, StringComparer.Ordinal).ToArray()
                : rows.OrderBy(r => r.MatchDraws).ThenBy(r => r.PlayerName, StringComparer.Ordinal).ToArray(),
            "matchWinrate" => GlobalNullLastSort(rows, r => r.MatchWinrate, descending),
            "playedGameCount" => descending
                ? rows.OrderByDescending(r => r.PlayedGameCount).ThenBy(r => r.PlayerName, StringComparer.Ordinal).ToArray()
                : rows.OrderBy(r => r.PlayedGameCount).ThenBy(r => r.PlayerName, StringComparer.Ordinal).ToArray(),
            "gameWins" => descending
                ? rows.OrderByDescending(r => r.GameWins).ThenBy(r => r.PlayerName, StringComparer.Ordinal).ToArray()
                : rows.OrderBy(r => r.GameWins).ThenBy(r => r.PlayerName, StringComparer.Ordinal).ToArray(),
            "gameLosses" => descending
                ? rows.OrderByDescending(r => r.GameLosses).ThenBy(r => r.PlayerName, StringComparer.Ordinal).ToArray()
                : rows.OrderBy(r => r.GameLosses).ThenBy(r => r.PlayerName, StringComparer.Ordinal).ToArray(),
            "gameWinrate" => GlobalNullLastSort(rows, r => r.GameWinrate, descending),
            _ => throw new InvalidOperationException($"Unknown sort: {sort}")
        };
    }

    private static GlobalPlayerStatistics[] GlobalNullLastSort(
        IReadOnlyList<GlobalPlayerStatistics> rows,
        Func<GlobalPlayerStatistics, double?> selector,
        bool descending)
    {
        var withValue = rows.Where(r => selector(r).HasValue);
        var withoutValue = rows.Where(r => !selector(r).HasValue)
            .OrderBy(r => r.PlayerName, StringComparer.Ordinal);
        var ordered = descending
            ? withValue.OrderByDescending(r => selector(r)!.Value).ThenBy(r => r.PlayerName, StringComparer.Ordinal)
            : withValue.OrderBy(r => selector(r)!.Value).ThenBy(r => r.PlayerName, StringComparer.Ordinal);
        return ordered.Concat(withoutValue).ToArray();
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
        var document = aggregate.ReadDocument();
        return Results.Ok(new PublicLeagueDetailResponse(
            document.Id,
            document.Name,
            document.Status,
            document.Tournaments,
            aggregate.Version,
            aggregate.UpdatedAt));
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

    private static string EscapeLikePattern(string value) =>
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

    private static bool IsNotModified(HttpRequest request, string etag) =>
        request.Headers.IfNoneMatch.Any(value => string.Equals(value, etag, StringComparison.Ordinal));

    private static string HashETag(string value) =>
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

internal sealed record GlobalPlayerStatisticsResponse(
    IReadOnlyList<GlobalPlayerStatisticsRow> Items,
    int Page,
    int PageSize,
    int TotalCount,
    string? Sort,
    string? Direction);

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
