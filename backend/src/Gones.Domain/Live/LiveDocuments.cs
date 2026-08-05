using Gones.Domain.Leagues;

namespace Gones.Domain.Live;

public sealed record LiveTournamentPlayerDocument(
    string Id,
    string Name,
    bool Paid,
    bool Dropped,
    int InitialWins,
    int InitialDraws,
    int InitialLosses,
    string Archetype);

public sealed record LiveTournamentRoundEntryDocument(RoundEntry Entry, bool ResultEntered);

public sealed record LiveTournamentRoundDocument(
    string Id,
    int RoundNumber,
    IReadOnlyList<LiveTournamentRoundEntryDocument> Entries,
    bool Validated);

public sealed record LiveTournamentCheckpointDocument(
    string Id,
    string Label,
    string CreatedAt,
    string Stage,
    int CurrentRoundNumber,
    int RoundCount,
    bool PaidTrackingEnabled,
    IReadOnlyList<LiveTournamentPlayerDocument> Players,
    IReadOnlyList<LiveTournamentRoundDocument> Rounds);

public sealed record LiveTournamentDocument(
    string Id,
    string Name,
    string LeagueId,
    string TournamentDate,
    string Type,
    int RoundCount,
    bool CustomRoundCount,
    bool PaidTrackingEnabled,
    long PairingSeed,
    IReadOnlyList<string> FirstRoundPlayerOrder,
    string Stage,
    int CurrentRoundNumber,
    IReadOnlyList<LiveTournamentPlayerDocument> Players,
    IReadOnlyList<LiveTournamentRoundDocument> Rounds,
    IReadOnlyList<LiveTournamentCheckpointDocument> Checkpoints,
    string? FinalizedTournamentId,
    int DocumentVersion,
    string CreatedAt,
    string UpdatedAt);

public sealed record LiveStandingRow(
    int Rank,
    string PlayerId,
    string PlayerName,
    bool Paid,
    bool Dropped,
    int Points,
    int MatchWins,
    int MatchDraws,
    int MatchLosses,
    int Byes,
    int PlayedMatchCount,
    int MatchAssignmentCount,
    int GameWins,
    int GameLosses,
    double GameWinPercentage,
    double OpponentsMatchWinPercentage,
    double OpponentsGameWinPercentage);
