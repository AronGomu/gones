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
        "playedGameCount", "gameWins", "gameLosses", "gameWinrate",
        "rating", "tournamentsPlayed"
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
        app.MapGet("/api/leagues-archive/all", ListCatalogAsync)
            .AllowAnonymous()
            .Produces<PublicLeagueCatalogResponse>()
            .Produces(StatusCodes.Status304NotModified);
        app.MapGet("/api/leagues-archive/all/documents", ListDocumentCatalogAsync)
            .AllowAnonymous()
            .Produces<PublicLeagueDocumentCatalogResponse>()
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
        IConfiguration configuration,
        IClock clock,
        CancellationToken cancellationToken)
    {
        var pageNumber = page ?? 1;
        var size = pageSize ?? GlobalStatsDefaultPageSize;
        var exposeDecayedRating = PlayerStatisticsDecayedRatingExposure.Enabled(configuration);
        if (pageNumber < 1) throw Validation("page", "Page must be at least 1.");
        if (!GlobalStatsAllowedPageSizes.Contains(size)) throw Validation("pageSize", "Page size must be 10, 25, 50, or 100.");
        if (search?.Length > MaximumSearchLength) throw Validation("search", $"Search must be at most {MaximumSearchLength} characters.");
        if (sort is not null && !GlobalStatsSortAllowlist.Contains(sort) && !(sort == "decayedRating" && exposeDecayedRating))
            throw Validation("sort", "Sort column is not valid.");
        if (direction is not null && direction is not ("asc" or "desc")) throw Validation("direction", "Direction must be asc or desc.");

        // ADR 0040: the numbers come from the materialized read model, so Postgres does the filtering,
        // the ordering and the paging. Nothing on this path reads a League document any more.
        var query = FilterGlobalStats(database.PlayerStatistics.AsNoTracking(), search);
        var total = await query.CountAsync(cancellationToken);

        // The inactive flag and the bucket it orders by come from the request clock rather than the read
        // model (ADR 0043), so the day is part of what this body says: without it, a client cached one
        // side of a midnight boundary would keep being told 304 against yesterday's buckets.
        var today = clock.GetCurrentInstant().InUtc().Date;
        var normalizedQuery = $"sort={sort}&dir={direction}&search={search?.Trim() ?? string.Empty}&page={pageNumber}&size={size}";
        var etag = HashETag($"{await ReadModelStampAsync(database, cancellationToken)}:{PlayerRankingRules.Iso(today)}:{total}:{normalizedQuery}:{exposeDecayedRating}");
        SetPublicCache(response, etag);
        if (IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);

        var isDescending = !string.Equals(direction, "asc", StringComparison.Ordinal);
        var offset = (pageNumber - 1) * size;
        var rows = await OrderGlobalStats(query, sort, isDescending, today, exposeDecayedRating)
            .Skip(offset)
            .Take(size)
            .ToListAsync(cancellationToken);
        var items = rows.Select((row, index) => ToGlobalStatsRow(offset + index + 1, row, today, exposeDecayedRating)).ToList();

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
        IClock clock,
        CancellationToken cancellationToken)
    {
        var ceiling = configuration.GetValue(GlobalStatsMaximumCatalogSizeKey, GlobalStatsMaximumCatalogSize);
        var total = await database.PlayerStatistics.AsNoTracking().CountAsync(cancellationToken);
        var exposeDecayedRating = PlayerStatisticsDecayedRatingExposure.Enabled(configuration);
        var today = clock.GetCurrentInstant().InUtc().Date;
        var etag = HashETag($"{await ReadModelStampAsync(database, cancellationToken)}:{PlayerRankingRules.Iso(today)}:{total}:catalog:{ceiling}:{exposeDecayedRating}");
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
            .Select((row, index) => ToGlobalStatsRow(index + 1, row, today, exposeDecayedRating))
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
    ///
    /// <para>The default is the three-bucket partition of ADR 0043 rather than a single column: active
    /// ranked players by rating, then inactive ranked ones by rating, then the provisional ones by how
    /// much they have played. The bucket is computed in the projection so Postgres does the ordering,
    /// and the two counts below it are keyed off the provisional test so that they only break ties
    /// inside the last bucket — a ranked player is separated by rating and then by name, exactly as
    /// before.</para>
    /// </summary>
    private static IQueryable<PlayerStatisticsRow> OrderGlobalStats(
        IQueryable<PlayerStatisticsRow> query,
        string? sort,
        bool descending,
        LocalDate today,
        bool exposeDecayedRating = false)
    {
        if (sort is null)
        {
            // Stored last-played dates are fixed-width ISO, so "idle for twelve whole months" is one
            // string comparison against this date. It collates as C for the same reason the name
            // tiebreak does: PlayerRankingRules decides the flag ordinally in memory, the database
            // decides the bucket that orders by it, and the badge would contradict the ordering if the
            // two ever disagreed on a comparison. The database collation is en_US, not C.
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
                    : row.Rating)
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
            "playedMatchCount" => GlobalSortByCount(query, row => row.PlayedMatchCount, descending),
            "matchWins" => GlobalSortByCount(query, row => row.MatchWins, descending),
            "matchLosses" => GlobalSortByCount(query, row => row.MatchLosses, descending),
            "matchDraws" => GlobalSortByCount(query, row => row.MatchDraws, descending),
            "matchWinrate" => GlobalSortByWinrate(query, row => row.MatchWinrate, row => row.MatchWinrate == null, descending),
            "playedGameCount" => GlobalSortByCount(query, row => row.PlayedGameCount, descending),
            "gameWins" => GlobalSortByCount(query, row => row.GameWins, descending),
            "gameLosses" => GlobalSortByCount(query, row => row.GameLosses, descending),
            "gameWinrate" => GlobalSortByWinrate(query, row => row.GameWinrate, row => row.GameWinrate == null, descending),
            "rating" => GlobalSortByRating(query, row => row.Rating, descending),
            "tournamentsPlayed" => GlobalSortByCount(query, row => row.TournamentsPlayed, descending),
            "decayedRating" when exposeDecayedRating => GlobalSortByRating(query, row => row.DecayedRating, descending),
            _ => throw new InvalidOperationException($"Unknown sort: {sort}")
        };
    }

    private static IQueryable<PlayerStatisticsRow> GlobalSortByCount(
        IQueryable<PlayerStatisticsRow> query,
        Expression<Func<PlayerStatisticsRow, int>> column,
        bool descending) =>
        (descending ? query.OrderByDescending(column) : query.OrderBy(column))
            .ThenBy(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation));

    /// <summary>
    /// The winrate twin without the nulls-last branch: a rating is stored on every row, so there is no
    /// missing value whose placement would flip with the direction. It sorts on the stored double, not
    /// the integer the wire carries, so two ratings that round to the same number keep their real order.
    /// </summary>
    private static IQueryable<PlayerStatisticsRow> GlobalSortByRating(
        IQueryable<PlayerStatisticsRow> query,
        Expression<Func<PlayerStatisticsRow, double>> column,
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

    /// <summary>
    /// One read-model row on the wire. The rating is rounded here rather than in the browser so every
    /// surface shows the same integer, and the delta is the difference between the two rounded numbers
    /// rather than the stored double — a client that prints rating and delta must never be able to
    /// derive a previous rating that disagrees with the one it was sent.
    /// </summary>
    internal static GlobalPlayerStatisticsRow ToGlobalStatsRow(int position, PlayerStatisticsRow row, LocalDate today, bool exposeDecayedRating = false)
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

    /// <summary>
    /// The whole archive in one cacheable body, the League twin of <c>/api/events/all</c> (ADR 0039),
    /// as summary rows rather than whole documents (ADR 0042). The two numbers the list card prints are
    /// denormalized onto the aggregate, so the rows are projected straight out of Postgres and no
    /// League document is deserialized to answer this route — ~150 bytes a row against ~7.2 KB.
    /// The documents themselves live at <c>/api/leagues-archive/all/documents</c>.
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
        var (total, notModified) = await PrepareCatalogAsync("catalog", ceiling, request, response, database, cancellationToken);
        if (notModified) return Results.StatusCode(StatusCodes.Status304NotModified);

        var fetched = await VisibleLeagues(database)
            .OrderByDescending(aggregate => aggregate.UpdatedAt)
            .ThenBy(aggregate => aggregate.Id)
            .Take(ceiling + 1)
            .Select(aggregate => new PublicLeagueCatalogItemResponse(
                aggregate.DocumentId,
                aggregate.Name,
                aggregate.Status,
                aggregate.UpdatedAt,
                aggregate.Version,
                aggregate.TournamentCount,
                aggregate.PlayerCount))
            .ToListAsync(cancellationToken);
        var truncated = CapToCeiling(fetched, ceiling, total, loggerFactory);

        return Results.Ok(new PublicLeagueCatalogResponse(fetched, total, truncated));
    }

    /// <summary>
    /// The same archive as whole documents, which is what the Settings export needs — it is the body
    /// <see cref="ListCatalogAsync"/> used to return, moved to its own route (ADR 0042). A
    /// <c>?documents=true</c> flag was rejected: on a <c>public, max-age=3600</c> response it would make
    /// two different bodies share one ETag namespace and turn the OpenAPI response schema into a union.
    /// </summary>
    private static async Task<IResult> ListDocumentCatalogAsync(
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var ceiling = configuration.GetValue(MaximumCatalogSizeKey, MaximumCatalogSize);
        var (total, notModified) = await PrepareCatalogAsync("documents", ceiling, request, response, database, cancellationToken);
        if (notModified) return Results.StatusCode(StatusCodes.Status304NotModified);

        var fetched = await VisibleLeagues(database)
            .OrderByDescending(aggregate => aggregate.UpdatedAt)
            .ThenBy(aggregate => aggregate.Id)
            .Take(ceiling + 1)
            .ToListAsync(cancellationToken);
        var truncated = CapToCeiling(fetched, ceiling, total, loggerFactory);

        return Results.Ok(new PublicLeagueDocumentCatalogResponse(fetched.Select(ToDetail).ToList(), total, truncated));
    }

    private static IQueryable<LeagueArchiveAggregate> VisibleLeagues(GonesDbContext database) =>
        database.LeagueArchiveAggregates.AsNoTracking().Where(aggregate => aggregate.DeletedAt == null);

    /// <summary>
    /// The prologue both <c>/all*</c> routes share: the archive count, the ETag and the caching headers.
    /// <paramref name="representation"/> is what keeps the two bodies in separate ETag namespaces — the
    /// stamp is identical for both, so without it a client holding the summary ETag would be answered
    /// 304 and go on reading a document catalog, or the reverse.
    /// </summary>
    private static async Task<(int Total, bool NotModified)> PrepareCatalogAsync(
        string representation,
        int ceiling,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var query = VisibleLeagues(database);
        var total = await query.CountAsync(cancellationToken);
        // Every write bumps `UpdatedAt` to now, so the newest row plus the count identifies the archive:
        // an edit moves the stamp, a create or a soft delete moves the count.
        var stamp = await query
            .OrderByDescending(aggregate => aggregate.UpdatedAt)
            .ThenBy(aggregate => aggregate.Id)
            .Select(aggregate => new { aggregate.UpdatedAt, aggregate.DocumentId, aggregate.Version })
            .FirstOrDefaultAsync(cancellationToken);
        var etag = HashETag($"{total}:{stamp?.UpdatedAt}:{stamp?.DocumentId}:{stamp?.Version}:{representation}:{ceiling}");
        response.Headers.ETag = etag;
        response.Headers.CacheControl = CatalogCacheControl;
        return (total, IsNotModified(request, etag));
    }

    /// <summary>
    /// Both routes read one row past the ceiling, which is what tells a truncated catalog from an
    /// archive that ends exactly there. Drops the extra row and reports whether there was one.
    /// </summary>
    private static bool CapToCeiling<T>(List<T> fetched, int ceiling, int total, ILoggerFactory loggerFactory)
    {
        if (fetched.Count <= ceiling) return false;
        fetched.RemoveRange(ceiling, fetched.Count - ceiling);
        loggerFactory.CreateLogger("Gones.Api.Leagues")
            .LogWarning("Public League catalog truncated: total={Total} ceiling={Ceiling}", total, ceiling);
        return true;
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

internal sealed record PublicLeagueDetailResponse(
    string Id,
    string Name,
    string Status,
    IReadOnlyList<TournamentDocument> Tournaments,
    long DocumentVersion,
    Instant UpdatedAt);

/// <summary>A catalog row: everything the League Archive list card prints, and nothing else (ADR 0042).</summary>
internal sealed record PublicLeagueCatalogItemResponse(
    string Id,
    string Name,
    string Status,
    Instant UpdatedAt,
    long DocumentVersion,
    int TournamentCount,
    int PlayerCount);

internal sealed record PublicLeagueCatalogResponse(
    IReadOnlyList<PublicLeagueCatalogItemResponse> Items,
    int TotalCount,
    bool Truncated);

internal sealed record PublicLeagueDocumentCatalogResponse(
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

internal sealed record LeagueExportResponse(
    string Kind,
    int GonesDataVersion,
    string GonesAppVersion,
    Instant ExportedAt,
    LeagueDocument League);
