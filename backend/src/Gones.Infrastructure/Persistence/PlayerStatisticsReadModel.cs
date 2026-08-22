using Gones.Domain.Leagues;
using NodaTime;

namespace Gones.Infrastructure.Persistence;

/// <summary>
/// The three partitions <c>player_statistics</c> is keyed by. A standalone Tournament belongs to no
/// League and no LeagueSeason, so it feeds <see cref="Global"/> and nothing else.
/// </summary>
public static class PlayerStatisticsScope
{
    public const string Global = "global";
    public const string League = "league";
    public const string Season = "season";

    /// <summary><c>scope_id</c> is the empty string exactly when <c>scope_kind</c> is <see cref="Global"/>.</summary>
    public const string GlobalScopeId = "";

    public static bool IsKnownKind(string? kind) => kind is Global or League or Season;
}

/// <summary>
/// One materialized row of <see cref="GlobalPlayerStatistics"/>, keyed by scope and exact Player Name
/// (ADR 0040). The table is a pure read model: it is never edited in place, only rewritten wholesale by
/// <c>PlayerStatisticsRebuildService</c> inside the transaction of the archive write that changed it.
/// </summary>
public sealed class PlayerStatisticsRow
{
    /// <summary>Which partition of the archive this row was computed over: "global", "league" or "season".</summary>
    public required string ScopeKind { get; init; }

    /// <summary>The League or LeagueSeason document id, and the empty string for the global scope.</summary>
    public required string ScopeId { get; init; }

    public required string PlayerName { get; init; }
    public required int PlayedMatchCount { get; init; }
    public required int MatchWins { get; init; }
    public required int MatchLosses { get; init; }
    public required int MatchDraws { get; init; }
    public double? MatchWinrate { get; init; }
    public required int PlayedGameCount { get; init; }
    public required int GameWins { get; init; }
    public required int GameLosses { get; init; }
    public double? GameWinrate { get; init; }
    public OpponentRecord? Nemesis { get; init; }
    public OpponentRecord? Rival { get; init; }
    public PlayerArchetypeUsage? MostPlayedArchetype { get; init; }

    // ADR 0043. Replayed from the archive by the same rebuild that fills everything above, so these are
    // derived columns like the rest of the row and never edited on their own.
    public required double Rating { get; init; }
    public required double RatingDeviation { get; init; }
    public required double RatingVolatility { get; init; }
    public required double PreviousRating { get; init; }
    public required double LastRatingDelta { get; init; }
    public required int TournamentsPlayed { get; init; }
    public string? LastPlayedDate { get; init; }
    public required double DecayedRating { get; init; }

    public static PlayerStatisticsRow From(GlobalPlayerStatistics statistics, string scopeKind, string scopeId) => new()
    {
        ScopeKind = scopeKind,
        ScopeId = scopeId,
        PlayerName = statistics.PlayerName,
        PlayedMatchCount = statistics.PlayedMatchCount,
        MatchWins = statistics.MatchWins,
        MatchLosses = statistics.MatchLosses,
        MatchDraws = statistics.MatchDraws,
        MatchWinrate = statistics.MatchWinrate,
        PlayedGameCount = statistics.PlayedGameCount,
        GameWins = statistics.GameWins,
        GameLosses = statistics.GameLosses,
        GameWinrate = statistics.GameWinrate,
        Nemesis = statistics.Nemesis,
        Rival = statistics.Rival,
        MostPlayedArchetype = statistics.MostPlayedArchetype,
        Rating = statistics.Rating,
        RatingDeviation = statistics.RatingDeviation,
        RatingVolatility = statistics.RatingVolatility,
        PreviousRating = statistics.PreviousRating,
        LastRatingDelta = statistics.LastRatingDelta,
        TournamentsPlayed = statistics.TournamentsPlayed,
        LastPlayedDate = statistics.LastPlayedDate,
        DecayedRating = statistics.DecayedRating
    };

    /// <summary>The statistics half of the row. The scope is the key it was filed under, not part of them.</summary>
    public GlobalPlayerStatistics ToGlobalPlayerStatistics() => new(
        PlayerName,
        PlayedMatchCount,
        MatchWins,
        MatchLosses,
        MatchDraws,
        MatchWinrate,
        PlayedGameCount,
        GameWins,
        GameLosses,
        GameWinrate,
        Nemesis,
        Rival,
        MostPlayedArchetype,
        Rating,
        RatingDeviation,
        RatingVolatility,
        PreviousRating,
        LastRatingDelta,
        TournamentsPlayed,
        LastPlayedDate,
        DecayedRating);
}

/// <summary>
/// The single row that says which formula filled <c>player_statistics</c>, and when. A stored version
/// other than <see cref="PlayerStatisticsFormula.Version"/> — or no row at all — is what makes the
/// startup rebuild run.
/// </summary>
public sealed class PlayerStatisticsMeta
{
    /// <summary>The table holds one row and a check constraint keeps it that way.</summary>
    public const int SingletonId = 1;

    public int Id { get; init; } = SingletonId;
    public int FormulaVersion { get; set; }
    public Instant RebuiltAt { get; set; }
}
