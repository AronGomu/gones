using System.Globalization;
using System.Linq.Expressions;
using System.Security.Cryptography;
using System.Text;
using Gones.Api.Errors;
using Gones.Api.Leagues;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Archive;

/// <summary>
/// The scoped rankings: the same materialized read model as the legacy route, addressed by the
/// partition it was computed in. <c>scopeKind=global</c> is the whole archive; <c>league</c> and
/// <c>season</c> select the stored rows for one League or one LeagueSeason, whose ratings, match
/// counts, tournament counts and winrates were each replayed inside that scope.
///
/// <para>Deliberately self-contained rather than calling into <c>PublicLeagueEndpoints</c>: that file
/// is deleted when the legacy archive is retired, and the new surface must not depend on the dying
/// one. The response field names are identical on the wire; only the C# type names differ, so the two
/// coexist in one OpenAPI document.</para>
///
/// <para>A <c>scopeId</c> with no rows is a legal query over an empty partition and answers
/// <c>200</c> with an empty page. It is not a <c>404</c>: the scope is a filter, not a resource.</para>
/// </summary>
internal static class ArchivePlayerStatisticsEndpoints
{
    private const string CatalogCacheControl = "public, max-age=3600";
    private const int MaximumSearchLength = 200;
    private const int MaximumScopeIdLength = 200;
    private const int DefaultPageSize = 100;
    private static readonly int[] AllowedPageSizes = [10, 25, 50, 100];

    /// <summary>Postgres collation that orders text byte by byte, the way <c>StringComparer.Ordinal</c> does.</summary>
    internal const int MaximumPlayerNameLength = 200;
    private const string OrdinalCollation = "C";

    /// <summary>The rankings catalog ceiling, under the key the legacy catalog already uses.</summary>
    public const int MaximumCatalogSize = 5000;
    public const string MaximumCatalogSizeKey = "Gones:GlobalStats:MaximumCatalogSize";

    /// <summary>
    /// The contract's short sort keys, mapped onto the columns the legacy endpoint already sorts by.
    /// Both spellings are accepted so neither the contract nor the existing surface is broken.
    /// </summary>
    private static readonly Dictionary<string, string> SortAliases = new(StringComparer.Ordinal)
    {
        ["matches"] = "playedMatchCount",
        ["wins"] = "matchWins",
        ["losses"] = "matchLosses",
        ["winrate"] = "matchWinrate",
        ["tournaments"] = "tournamentsPlayed"
    };

    private static readonly HashSet<string> SortAllowlist = new(StringComparer.Ordinal)
    {
        "playedMatchCount", "matchWins", "matchLosses", "matchDraws", "matchWinrate",
        "playedGameCount", "gameWins", "gameLosses", "gameWinrate",
        "rating", "tournamentsPlayed", "name"
    };

    public static void MapArchivePlayerStatisticsEndpoints(this WebApplication app)
    {
        app.MapGet("/api/archive/global-player-statistics", GetAsync)
            .AllowAnonymous()
            .WithName("GetArchiveGlobalPlayerStatistics")
            .Produces<ArchiveGlobalPlayerStatisticsResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status400BadRequest);
        app.MapGet("/api/archive/global-player-statistics/all", GetCatalogAsync)
            .AllowAnonymous()
            .WithName("GetArchiveGlobalPlayerStatisticsCatalog")
            .Produces<ArchiveGlobalPlayerStatisticsCatalogResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status400BadRequest);
    }

    private static async Task<IResult> GetAsync(
        string? scopeKind,
        string? scopeId,
        int? page,
        int? pageSize,
        string? search,
        string? sort,
        string? direction,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        IConfiguration configuration,
        IClock clock,
        CancellationToken cancellationToken)
    {
        var scope = ValidateScope(scopeKind, scopeId);
        var pageNumber = page ?? 1;
        var size = pageSize ?? DefaultPageSize;
        var exposeDecayedRating = PlayerStatisticsDecayedRatingExposure.Enabled(configuration);
        if (pageNumber < 1) throw Validation("page", "Page must be at least 1.");
        if (!AllowedPageSizes.Contains(size)) throw Validation("pageSize", "Page size must be 10, 25, 50, or 100.");
        if (search?.Length > MaximumSearchLength) throw Validation("search", $"Search must be at most {MaximumSearchLength} characters.");
        var column = NormalizeSort(sort, exposeDecayedRating);
        if (direction is not null && direction is not ("asc" or "desc")) throw Validation("direction", "Direction must be asc or desc.");

        var query = Filter(Scoped(database, scope), search);
        var total = await query.CountAsync(cancellationToken);
        var today = clock.GetCurrentInstant().InUtc().Date;
        var normalizedQuery = $"sort={sort}&dir={direction}&search={search?.Trim() ?? string.Empty}&page={pageNumber}&size={size}";
        var etag = HashETag($"{await StampAsync(database, cancellationToken)}:{PlayerRankingRules.Iso(today)}:{scope.Kind}:{scope.Id}:{total}:{normalizedQuery}:{exposeDecayedRating}");
        SetCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);

        var isDescending = !string.Equals(direction, "asc", StringComparison.Ordinal);
        var offset = (pageNumber - 1) * size;
        var rows = await Order(query, column, isDescending, today)
            .Skip(offset)
            .Take(size)
            .ToListAsync(cancellationToken);
        var items = rows.Select((row, index) => ToRow(offset + index + 1, row, today, exposeDecayedRating)).ToList();

        return Results.Ok(new ArchiveGlobalPlayerStatisticsResponse(items, pageNumber, size, total, sort, direction));
    }

    private static async Task<IResult> GetCatalogAsync(
        string? scopeKind,
        string? scopeId,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        IClock clock,
        CancellationToken cancellationToken)
    {
        var scope = ValidateScope(scopeKind, scopeId);
        var ceiling = configuration.GetValue(MaximumCatalogSizeKey, MaximumCatalogSize);
        var total = await Scoped(database, scope).CountAsync(cancellationToken);
        var exposeDecayedRating = PlayerStatisticsDecayedRatingExposure.Enabled(configuration);
        var today = clock.GetCurrentInstant().InUtc().Date;
        var etag = HashETag($"{await StampAsync(database, cancellationToken)}:{PlayerRankingRules.Iso(today)}:{scope.Kind}:{scope.Id}:{total}:catalog:{ceiling}:{exposeDecayedRating}");
        SetCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);

        // One row past the ceiling is what tells a truncated catalog from a scope that ends exactly there.
        var fetched = await Scoped(database, scope)
            .OrderByDescending(row => row.PlayedMatchCount)
            .ThenBy(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation))
            .Take(ceiling + 1)
            .ToListAsync(cancellationToken);
        var truncated = fetched.Count > ceiling;
        var items = (truncated ? fetched.Take(ceiling) : fetched)
            .Select((row, index) => ToRow(index + 1, row, today, exposeDecayedRating))
            .ToList();
        if (truncated)
        {
            loggerFactory.CreateLogger("Gones.Api.Archive")
                .LogWarning("Scoped player statistics catalog truncated: scope={ScopeKind}:{ScopeId} total={Total} ceiling={Ceiling}", scope.Kind, scope.Id, total, ceiling);
        }

        return Results.Ok(new ArchiveGlobalPlayerStatisticsCatalogResponse(items, total, truncated));
    }

    private readonly record struct StatisticsScope(string Kind, string Id);

    /// <summary>
    /// The scope selection. <c>scopeId</c> is required for a League or a Season and ignored for the
    /// global scope, whose stored id is the empty string. An id nothing matches is not an error — it
    /// selects an empty partition.
    /// </summary>
    private static StatisticsScope ValidateScope(string? scopeKind, string? scopeId)
    {
        var kind = string.IsNullOrWhiteSpace(scopeKind) ? PlayerStatisticsScope.Global : scopeKind;
        if (!PlayerStatisticsScope.IsKnownKind(kind))
            throw Validation("scopeKind", "Scope kind must be global, league, or season.");
        if (kind == PlayerStatisticsScope.Global) return new StatisticsScope(kind, PlayerStatisticsScope.GlobalScopeId);
        if (string.IsNullOrWhiteSpace(scopeId))
            throw Validation("scopeId", "Scope id is required for a league or season scope.");
        if (scopeId.Length > MaximumScopeIdLength)
            throw Validation("scopeId", $"Scope id must contain 1 to {MaximumScopeIdLength} characters.");
        return new StatisticsScope(kind, scopeId);
    }

    private static IQueryable<PlayerStatisticsRow> Scoped(GonesDbContext database, StatisticsScope scope) =>
        database.PlayerStatistics.AsNoTracking()
            .Where(row => row.ScopeKind == scope.Kind && row.ScopeId == scope.Id);

    private static string? NormalizeSort(string? sort, bool exposeDecayedRating)
    {
        if (sort is null) return null;
        if (sort == "decayedRating" && exposeDecayedRating) return sort;
        if (SortAliases.TryGetValue(sort, out var mapped)) return mapped;
        if (SortAllowlist.Contains(sort)) return sort;
        throw Validation("sort", "Sort column is not valid.");
    }

    private static IQueryable<PlayerStatisticsRow> Filter(IQueryable<PlayerStatisticsRow> query, string? search)
    {
        if (string.IsNullOrWhiteSpace(search)) return query;
        var term = EscapeLikePattern(search.Trim());
        return query.Where(row => EF.Functions.ILike(row.PlayerName, $"%{term}%", "\\"));
    }

    /// <summary>
    /// The ADR 0043 three-bucket default — active ranked by rating, then inactive ranked by rating,
    /// then provisional by how much they have played — or one explicit column. Every tie breaks on the
    /// Player Name collated <c>C</c>, because Player Names are exact and the database collation is not.
    /// </summary>
    private static IQueryable<PlayerStatisticsRow> Order(
        IQueryable<PlayerStatisticsRow> query,
        string? sort,
        bool descending,
        LocalDate today)
    {
        if (sort is null)
        {
            var cutoff = PlayerRankingRules.InactiveCutoff(today);
            return query
                .OrderBy(row => row.TournamentsPlayed < PlayerRankingRules.ProvisionalTournamentThreshold
                    ? PlayerRankingRules.ProvisionalBucket
                    : row.LastPlayedDate == null
                      || string.Compare(EF.Functions.Collate(row.LastPlayedDate, OrdinalCollation), cutoff) <= 0
                        ? PlayerRankingRules.InactiveRankedBucket
                        : PlayerRankingRules.ActiveRankedBucket)
                .ThenByDescending(row => row.TournamentsPlayed < PlayerRankingRules.ProvisionalTournamentThreshold
                    ? 0d
                    : Math.Floor(row.Rating + 0.5))
                .ThenByDescending(row => row.TournamentsPlayed < PlayerRankingRules.ProvisionalTournamentThreshold
                    ? row.TournamentsPlayed
                    : 0)
                .ThenByDescending(row => row.TournamentsPlayed < PlayerRankingRules.ProvisionalTournamentThreshold
                    ? row.PlayedMatchCount
                    : 0)
                .ThenBy(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation));
        }
        return sort switch
        {
            "name" => descending
                ? query.OrderByDescending(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation))
                : query.OrderBy(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation)),
            "playedMatchCount" => ByCount(query, row => row.PlayedMatchCount, descending),
            "matchWins" => ByCount(query, row => row.MatchWins, descending),
            "matchLosses" => ByCount(query, row => row.MatchLosses, descending),
            "matchDraws" => ByCount(query, row => row.MatchDraws, descending),
            "matchWinrate" => ByWinrate(query, row => row.MatchWinrate, row => row.MatchWinrate == null, descending),
            "playedGameCount" => ByCount(query, row => row.PlayedGameCount, descending),
            "gameWins" => ByCount(query, row => row.GameWins, descending),
            "gameLosses" => ByCount(query, row => row.GameLosses, descending),
            "gameWinrate" => ByWinrate(query, row => row.GameWinrate, row => row.GameWinrate == null, descending),
            "rating" => ByRating(query, row => Math.Floor(row.Rating + 0.5), descending),
            "tournamentsPlayed" => ByCount(query, row => row.TournamentsPlayed, descending),
            "decayedRating" => ByRating(query, row => Math.Floor(row.DecayedRating + 0.5), descending),
            _ => throw new InvalidOperationException($"Unknown sort: {sort}")
        };
    }

    private static IQueryable<PlayerStatisticsRow> ByCount(
        IQueryable<PlayerStatisticsRow> query,
        Expression<Func<PlayerStatisticsRow, int>> column,
        bool descending) =>
        (descending ? query.OrderByDescending(column) : query.OrderBy(column))
            .ThenBy(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation));

    /// <summary>Provisional players are pinned last in both directions: an unranked rating is not comparable to a ranked one.</summary>
    private static IQueryable<PlayerStatisticsRow> ByRating(
        IQueryable<PlayerStatisticsRow> query,
        Expression<Func<PlayerStatisticsRow, double>> column,
        bool descending)
    {
        var provisionalLast = query.OrderBy(row =>
            row.TournamentsPlayed < PlayerRankingRules.ProvisionalTournamentThreshold ? 1 : 0);
        return (descending ? provisionalLast.ThenByDescending(column) : provisionalLast.ThenBy(column))
            .ThenBy(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation));
    }

    /// <summary>A null winrate sorts last in both directions, rather than flipping with Postgres' own null placement.</summary>
    private static IQueryable<PlayerStatisticsRow> ByWinrate(
        IQueryable<PlayerStatisticsRow> query,
        Expression<Func<PlayerStatisticsRow, double?>> column,
        Expression<Func<PlayerStatisticsRow, bool>> missing,
        bool descending)
    {
        var nullsLast = query.OrderBy(missing);
        return (descending ? nullsLast.ThenByDescending(column) : nullsLast.ThenBy(column))
            .ThenBy(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation));
    }

    /// <summary>
    /// One stored row on the wire. The rating is rounded here so every surface prints the same integer,
    /// and the delta is the difference of the two rounded numbers so a client can never derive a
    /// previous rating that disagrees with the one it was sent.
    /// </summary>
    internal static ArchiveGlobalPlayerStatisticsRow ToRow(int position, PlayerStatisticsRow row, LocalDate today, bool exposeDecayedRating)
    {
        var rating = RoundRating(row.Rating);
        var previousRating = RoundRating(row.PreviousRating);
        return new(
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
            row.MostPlayedArchetype,
            rating,
            row.RatingDeviation,
            previousRating,
            rating - previousRating,
            row.TournamentsPlayed,
            row.LastPlayedDate,
            PlayerRankingRules.IsProvisional(row.TournamentsPlayed),
            PlayerRankingRules.IsInactive(row.LastPlayedDate, row.TournamentsPlayed, today),
            exposeDecayedRating ? RoundRating(row.DecayedRating) : null);
    }

    private static int RoundRating(double value) => (int)Math.Round(value, MidpointRounding.AwayFromZero);

    /// <summary>When the read model last changed. Every rebuild moves it, inside its own transaction.</summary>
    internal static async Task<string> StampAsync(GonesDbContext database, CancellationToken cancellationToken)
    {
        var rebuiltAt = await database.PlayerStatisticsMeta.AsNoTracking()
            .Select(meta => (Instant?)meta.RebuiltAt)
            .SingleOrDefaultAsync(cancellationToken);
        return rebuiltAt?.ToUnixTimeTicks().ToString(CultureInfo.InvariantCulture) ?? "unbuilt";
    }

    internal static string EscapeLikePattern(string value) =>
        value.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("%", "\\%", StringComparison.Ordinal)
            .Replace("_", "\\_", StringComparison.Ordinal);

    private static void SetCache(HttpResponse response, string etag)
    {
        response.Headers.ETag = etag;
        response.Headers.CacheControl = CatalogCacheControl;
    }

    internal static bool IsNotModified(HttpRequest request, string etag) =>
        request.Headers.IfNoneMatch.Any(value => string.Equals(value, etag, StringComparison.Ordinal));

    internal static string HashETag(string value) =>
        $"\"{Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)))}\"";

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });
}

internal sealed record ArchiveGlobalPlayerStatisticsResponse(
    IReadOnlyList<ArchiveGlobalPlayerStatisticsRow> Items,
    int Page,
    int PageSize,
    int TotalCount,
    string? Sort,
    string? Direction);

internal sealed record ArchiveGlobalPlayerStatisticsCatalogResponse(
    IReadOnlyList<ArchiveGlobalPlayerStatisticsRow> Items,
    int TotalCount,
    bool Truncated);

internal sealed record ArchiveGlobalPlayerStatisticsRow(
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
    PlayerArchetypeUsage? MostPlayedArchetype,
    int Rating,
    double RatingDeviation,
    int PreviousRating,
    int LastRatingDelta,
    int TournamentsPlayed,
    string? LastPlayedDate,
    bool Provisional,
    bool Inactive,
    int? DecayedRating);
