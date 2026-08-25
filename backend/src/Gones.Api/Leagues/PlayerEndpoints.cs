using Gones.Api.Archive;
using Gones.Api.Errors;
using Gones.Api.Security;
using Gones.Domain.Archive;
using Gones.Domain.Leagues;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Leagues;

/// <summary>
/// One player, whole: the materialized statistics row plus every Match that produced it, flat.
///
/// <para>The browser used to build this page by downloading every League document and recomputing the
/// numbers locally — megabytes per page view once the archive grows. The statistics half now comes
/// straight from <c>player_statistics</c>, so it agrees with Global Rankings by construction, and the
/// history half is flattened to ids and names instead of embedding the documents it was read from.</para>
///
/// <para>The history is returned whole rather than paged (round 1 Q4): the page filters, sorts and
/// pages it in the browser, so every existing filter-token and highlight feature survives untouched. A
/// ceiling keeps one pathological player from returning unbounded JSON.</para>
/// </summary>
internal static class PlayerEndpoints
{
    public const int MaximumHistorySize = 5000;
    public const string MaximumHistorySizeKey = "Gones:PlayerHistory:MaximumSize";
    private const string OrdinalCollation = "C";
    private const string PlayerCacheControl = "public, max-age=3600";

    public static void MapPlayerEndpoints(this WebApplication app)
    {
        app.MapGet("/api/players/{playerName}", GetPlayerAsync)
            .AllowAnonymous()
            // The global limiter buckets anonymous reads per client and leaves authenticated ones
            // unlimited, which is the wrong shape here: a cache-missing request streams and
            // deserializes every live archive aggregate, and varying the name defeats the ETag. This
            // policy partitions on the client key whether or not a token is present.
            .RequireRateLimiting(AuthRateLimiting.PublicReadPolicy)
            .WithName("GetPlayer")
            .Produces<PlayerDetailResponse>()
            .Produces(StatusCodes.Status304NotModified)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound);
    }

    private static async Task<IResult> GetPlayerAsync(
        string playerName,
        HttpRequest request,
        HttpResponse response,
        GonesDbContext database,
        IConfiguration configuration,
        IClock clock,
        CancellationToken cancellationToken)
    {
        var requested = LeagueNormalizer.TrimPlayerName(playerName);
        if (requested.Length == 0 || requested.Length > ArchivePlayerStatisticsEndpoints.MaximumPlayerNameLength)
            throw new ApiValidationException(new Dictionary<string, string[]>
            {
                [nameof(playerName)] = [$"Value must contain 1 to {ArchivePlayerStatisticsEndpoints.MaximumPlayerNameLength} characters."]
            });

        // A missing row is the whole 404: the read model only holds players with a played Match in a
        // completed Archive Tournament, so "no such player" and "no completed Match" are one answer and
        // neither one loads a document.
        var row = await FindAsync(database, requested, cancellationToken) ?? throw new ResourceNotFoundException();

        var exposeDecayedRating = PlayerStatisticsDecayedRatingExposure.Enabled(configuration);
        var ceiling = configuration.GetValue(MaximumHistorySizeKey, MaximumHistorySize);
        // The statistics half carries the inactive flag, which turns over on a date rather than on a
        // rebuild, so the day belongs in the ETag here for the same reason it does on the rankings.
        var today = clock.GetCurrentInstant().InUtc().Date;
        var etag = ArchivePlayerStatisticsEndpoints.HashETag(
            $"{await ArchivePlayerStatisticsEndpoints.StampAsync(database, cancellationToken)}:{PlayerRankingRules.Iso(today)}:player:{row.PlayerName}:{ceiling}:{exposeDecayedRating}");
        response.Headers.ETag = etag;
        response.Headers.CacheControl = PlayerCacheControl;
        if (ArchivePlayerStatisticsEndpoints.IsNotModified(request, etag)) return Results.StatusCode(StatusCodes.Status304NotModified);

        var matches = await BuildHistoryAsync(database, row.PlayerName, cancellationToken);
        var truncated = matches.Count > ceiling;
        var capped = truncated ? matches.Take(ceiling).ToList() : matches;

        // The row is mapped by the same function Global Rankings uses, so the page cannot fall behind a
        // field the rankings gained; `position` is 1 because a response holding one player has one row,
        // and it is not a rank.
        return Results.Ok(new PlayerDetailResponse(
            ArchivePlayerStatisticsEndpoints.ToRow(1, row, today, exposeDecayedRating),
            capped,
            matches.Count,
            truncated));
    }

    /// <summary>
    /// The row for this name. Player Names are exact and case-sensitive (ADR 0040), so an exact hit wins
    /// on the primary key; the case-insensitive fallback is what lets a link or a typed URL reach the
    /// row it obviously means, and it resolves ordinally when several spellings differ only in case.
    ///
    /// <para>Scoped to the global partition: the player page is the whole archive, and the read model now
    /// holds one row per (scope, player).</para>
    /// </summary>
    private static async Task<PlayerStatisticsRow?> FindAsync(GonesDbContext database, string playerName, CancellationToken cancellationToken)
    {
        var exact = await database.PlayerStatistics.AsNoTracking()
            .SingleOrDefaultAsync(row => row.ScopeKind == PlayerStatisticsScope.Global && row.PlayerName == playerName, cancellationToken);
        if (exact is not null) return exact;

        var pattern = ArchivePlayerStatisticsEndpoints.EscapeLikePattern(playerName);
        return await database.PlayerStatistics.AsNoTracking()
            .Where(row => row.ScopeKind == PlayerStatisticsScope.Global && EF.Functions.ILike(row.PlayerName, pattern, "\\"))
            .OrderBy(row => EF.Functions.Collate(row.PlayerName, OrdinalCollation))
            .FirstOrDefaultAsync(cancellationToken);
    }

    /// <summary>
    /// Every entry this player appears in, across every non-deleted Archive Tournament, newest first.
    /// The scope is the same one the statistics are accumulated over — completed Tournaments, whatever
    /// their Season's status — so the history cannot disagree with the numbers above it.
    /// </summary>
    private static async Task<List<PlayerMatchRow>> BuildHistoryAsync(GonesDbContext database, string playerName, CancellationToken cancellationToken)
    {
        var matches = new List<PlayerMatchRow>();
        // A standalone Tournament belongs to no Season, and its rows carry an empty League name.
        var seasonNames = await database.ArchiveLeagueSeasons.AsNoTracking()
            .Where(season => season.DeletedAt == null)
            .ToDictionaryAsync(season => season.DocumentId, season => season.Name, StringComparer.Ordinal, cancellationToken);
        var tournaments = database.ArchiveTournaments.AsNoTracking()
            .Where(row => row.DeletedAt == null && row.Status == "completed")
            .OrderBy(row => row.DocumentId)
            .AsAsyncEnumerable();

        await foreach (var row in tournaments.WithCancellation(cancellationToken))
        {
            var tournament = row.ReadDocument();
            var seasonId = tournament.SeasonId ?? string.Empty;
            var seasonName = tournament.SeasonId is not null && seasonNames.TryGetValue(tournament.SeasonId, out var name) ? name : string.Empty;
            for (var roundIndex = 0; roundIndex < tournament.Rounds.Count; roundIndex++)
            {
                foreach (var entry in tournament.Rounds[roundIndex].Entries)
                {
                    var match = ToRow(entry, seasonId, seasonName, tournament, roundIndex, playerName);
                    if (match is not null) matches.Add(match);
                }
            }
        }

        // Unstable sort, so the tiebreak runs all the way to a total order: the ceiling below keeps a
        // prefix of this list, and a prefix that reshuffles between requests is a page that flickers.
        matches.Sort((left, right) =>
        {
            var byDate = string.CompareOrdinal(right.TournamentDate, left.TournamentDate);
            if (byDate != 0) return byDate;
            var byRound = right.RoundIndex.CompareTo(left.RoundIndex);
            if (byRound != 0) return byRound;
            var byTournament = string.CompareOrdinal(left.TournamentId, right.TournamentId);
            return byTournament != 0 ? byTournament : string.CompareOrdinal(left.OpponentName, right.OpponentName);
        });
        return matches;
    }

    /// <summary>
    /// One entry as this player saw it, or null when the entry is invalid or not theirs. A Bye mirrors
    /// what the page renders for one today: the reserved opponent name and a 2-0 that is never counted
    /// as a played Match.
    /// </summary>
    private static PlayerMatchRow? ToRow(RoundEntry entry, string seasonId, string seasonName, ArchiveTournamentDocument archived, int roundIndex, string playerName)
    {
        // The standings helpers still speak the legacy record; one conversion, in one place.
        var tournament = ArchiveDocumentAdapter.ToLegacyTournament(archived, seasonId);
        if (!LeagueRules.Validate(entry).Valid) return null;
        if (entry is ByeRoundEntry bye)
        {
            if (LeagueNormalizer.TrimPlayerName(bye.PlayerName) != playerName) return null;
            var byeArchetype = bye.DeckArchetype.Trim();
            if (byeArchetype.Length == 0) byeArchetype = LeagueRules.RosterArchetype(tournament, playerName);
            return Row("bye", "Bye", 2, 0, byeArchetype, string.Empty);
        }

        if (entry is not MatchRoundEntry match) return null;
        var side = LeagueNormalizer.TrimPlayerName(match.Player1Name) == playerName ? 1
            : LeagueNormalizer.TrimPlayerName(match.Player2Name) == playerName ? 2
            : 0;
        if (side == 0) return null;
        var opponentName = LeagueNormalizer.TrimPlayerName(side == 1 ? match.Player2Name : match.Player1Name);
        var opponentSide = side == 1 ? 2 : 1;
        return Row(
            "match",
            opponentName,
            side == 1 ? match.Player1Score : match.Player2Score,
            side == 1 ? match.Player2Score : match.Player1Score,
            LeagueRules.SelectedArchetype(match, side, tournament, playerName),
            LeagueRules.SelectedArchetype(match, opponentSide, tournament, opponentName));

        PlayerMatchRow Row(string kind, string opponent, int ownScore, int opponentScore, string ownArchetype, string opponentArchetype) => new(
            kind,
            seasonId,
            seasonName,
            tournament.Id,
            tournament.Name,
            tournament.TournamentDate,
            roundIndex,
            opponent,
            ownScore,
            opponentScore,
            ownArchetype,
            opponentArchetype);
    }
}

/// <summary>
/// One entry of the history, flattened. The Season and the Tournament are ids and names rather than the
/// documents they came from, because embedding those documents is the cost this endpoint removes. A
/// standalone Tournament belongs to no Season, so both League fields are <c>""</c> for its rows. An
/// archetype nobody recorded is <c>""</c>, never null: the page renders a placeholder for the empty
/// string and would render "null" for a null.
/// </summary>
internal sealed record PlayerMatchRow(
    string Kind,
    string LeagueId,
    string LeagueName,
    string TournamentId,
    string TournamentName,
    string TournamentDate,
    int RoundIndex,
    string OpponentName,
    int OwnScore,
    int OpponentScore,
    string OwnArchetype,
    string OpponentArchetype);

internal sealed record PlayerDetailResponse(
    ArchiveGlobalPlayerStatisticsRow Statistics,
    IReadOnlyList<PlayerMatchRow> Matches,
    int TotalMatchCount,
    bool Truncated);
