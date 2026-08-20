using System.Text.Json;
using System.Text.Json.Serialization;

namespace Gones.Domain.Leagues;

public sealed record GonesData(int Version, IReadOnlyList<LeagueDocument> Leagues, IReadOnlyList<JsonElement> CalendarEvents);

public sealed record LeagueDocument(
    string Id,
    string Name,
    string Status,
    IReadOnlyList<TournamentDocument> Tournaments);

public sealed record TournamentDocument(
    string Id,
    string LeagueId,
    string Name,
    string TournamentDate,
    string Status,
    IReadOnlyList<RoundDocument> Rounds,
    IReadOnlyList<PlayerArchetypeDocument> PlayerArchetypes);

public sealed record RoundDocument(string Id, IReadOnlyList<RoundEntry> Entries);

public sealed record PlayerArchetypeDocument(string PlayerName, string Archetype);

[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(MatchRoundEntry), "match")]
[JsonDerivedType(typeof(ByeRoundEntry), "bye")]
[JsonDerivedType(typeof(InvalidRoundEntry), "invalid")]
public abstract record RoundEntry(string Id, string Table);

public sealed record MatchRoundEntry(
    string Id,
    string Table,
    string Player1Name,
    string Player2Name,
    int Player1Score,
    int Player2Score,
    string Player1DeckArchetype,
    string Player2DeckArchetype) : RoundEntry(Id, Table);

public sealed record ByeRoundEntry(
    string Id,
    string Table,
    string PlayerName,
    string DeckArchetype) : RoundEntry(Id, Table);

public sealed record InvalidRoundEntry(
    string Id,
    string RawText,
    string Table,
    string Player,
    string Result,
    string Opponent,
    string PlayerDecklist,
    string OpponentDecklist) : RoundEntry(Id, Table);

public sealed record ValidationResult(bool Valid, IReadOnlyList<string> Codes);

public sealed record TournamentWarning(
    string Code,
    string? RoundId = null,
    string? PlayerName = null,
    IReadOnlyList<string>? PlayerNames = null,
    IReadOnlyList<string>? EntryIds = null);

public sealed record RankingRow(
    string PlayerName,
    int Points,
    int MatchWins,
    int MatchDraws,
    int MatchLosses,
    int Byes,
    int PlayedMatchCount,
    int MatchAssignmentCount,
    int GameWins,
    int GameLosses,
    int Rank,
    double GameWinPercentage,
    double OpponentsMatchWinPercentage,
    double OpponentsGameWinPercentage,
    string? Archetype = null);

public sealed record TournamentResult(
    string Scope,
    bool Incomplete,
    bool Provisional,
    IReadOnlyList<RankingRow> Rows);

public sealed record LeagueResult(
    string Scope,
    string StartDate,
    string EndDate,
    bool Incomplete,
    bool Provisional,
    IReadOnlyList<RankingRow> Rows);

public sealed record RoundImportResult(IReadOnlyList<RoundEntry> Entries);

public sealed record PlayerStatisticsFilters(string? LeagueId = null, string? TournamentId = null, string? OpponentName = null);

public sealed record PlayerMatch(
    string Kind,
    LeagueDocument League,
    TournamentDocument Tournament,
    int RoundIndex,
    string OpponentName,
    int OwnScore,
    int OpponentScore);

public sealed record OpponentRecord(string Name, int Wins, int Losses);

public sealed record PlayerArchetypeUsage(string Name, int MatchCount);

public sealed record PlayerStatistics(
    string PlayerName,
    int PlayedMatchCount,
    int ByeCount,
    int MatchWins,
    int MatchLosses,
    int MatchDraws,
    int PlayedGameCount,
    int GameWins,
    int GameLosses,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] double? MatchWinrate,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] double? GameWinrate,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] OpponentRecord? Nemesis,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] OpponentRecord? Rival,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] PlayerArchetypeUsage? MostPlayedArchetype,
    IReadOnlyList<PlayerMatch> Matches);

/// <summary>
/// One player's global numbers (ADR 0040), plus their Glicko-2 rating (ADR 0043).
///
/// <para>The eight rating members are <see cref="JsonIgnoreAttribute"/>d on purpose. This record's JSON
/// shape is the frozen TypeScript parity contract in <c>fixtures/league-domain/v1/parity.json</c>, and
/// the rating is server-only and derived — it is replayed from the archive on every rebuild, never
/// exported and never restored. The API projects its own DTO from <c>player_statistics</c>, so nothing
/// downstream reads these through this record's serializer.</para>
/// </summary>
public sealed record GlobalPlayerStatistics(
    string PlayerName,
    int PlayedMatchCount,
    int MatchWins,
    int MatchLosses,
    int MatchDraws,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] double? MatchWinrate,
    int PlayedGameCount,
    int GameWins,
    int GameLosses,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] double? GameWinrate,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] OpponentRecord? Nemesis,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] OpponentRecord? Rival,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] PlayerArchetypeUsage? MostPlayedArchetype,
    [property: JsonIgnore] double Rating,
    [property: JsonIgnore] double RatingDeviation,
    [property: JsonIgnore] double RatingVolatility,
    [property: JsonIgnore] double PreviousRating,
    [property: JsonIgnore] double LastRatingDelta,
    [property: JsonIgnore] int TournamentsPlayed,
    [property: JsonIgnore] string? LastPlayedDate,
    [property: JsonIgnore] double DecayedRating);
