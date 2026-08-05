using Gones.Domain.Leagues;

namespace Gones.Domain.Live;

/// <summary>
/// Server-side Live Tournament intent transforms mirroring the Angular runner semantics
/// (live-tournament-runner.component.ts) on top of the golden-parity <see cref="LiveRules"/>.
/// Throws <see cref="ArgumentException"/> for invalid input, <see cref="KeyNotFoundException"/>
/// for missing children, and <see cref="InvalidOperationException"/> for state conflicts.
/// </summary>
public static class LiveCommands
{
    public static LiveTournamentDocument UpdateSettings(
        LiveTournamentDocument tournament,
        string? name,
        string? leagueId,
        string? tournamentDate,
        int? roundCount,
        bool? customRoundCount,
        bool? paidTrackingEnabled)
    {
        var updated = tournament with
        {
            Name = name is null ? tournament.Name : CoercedName(name),
            LeagueId = leagueId ?? tournament.LeagueId,
            TournamentDate = tournamentDate ?? tournament.TournamentDate,
            RoundCount = roundCount is null ? tournament.RoundCount : Math.Max(0, roundCount.Value),
            CustomRoundCount = customRoundCount ?? tournament.CustomRoundCount,
            PaidTrackingEnabled = paidTrackingEnabled ?? tournament.PaidTrackingEnabled
        };
        return WithAutomaticRoundCount(updated);
    }

    public static LiveTournamentDocument AddPlayer(
        LiveTournamentDocument tournament,
        string playerId,
        string name,
        int initialWins,
        int initialDraws,
        int initialLosses,
        string archetype)
    {
        if (tournament.Stage is not ("registration" or "standings"))
            throw new InvalidOperationException("Players can only be added during registration or standings.");
        var normalizedName = LeagueNormalizer.TrimPlayerName(name);
        if (normalizedName.Length == 0) throw new ArgumentException("Player name is required.", "name");
        if (PlayerNameExists(tournament, normalizedName, excludedPlayerId: null))
            throw new ArgumentException("Player is already registered.", "name");
        var player = LiveNormalizer.CreatePlayer(new LiveTournamentPlayerDocument(
            playerId,
            normalizedName,
            false,
            false,
            initialWins,
            initialDraws,
            initialLosses,
            archetype));
        IReadOnlyList<LiveTournamentPlayerDocument> players = tournament.Stage == "registration"
            ? [player, .. tournament.Players]
            : [.. tournament.Players, player];
        return WithAutomaticRoundCount(tournament with { Players = players });
    }

    public static LiveTournamentDocument EditPlayer(
        LiveTournamentDocument tournament,
        string playerId,
        string? name,
        int? initialWins,
        int? initialDraws,
        int? initialLosses,
        string? archetype)
    {
        var player = tournament.Players.FirstOrDefault(item => item.Id == playerId)
            ?? throw new KeyNotFoundException("Player was not found.");
        var nextName = name is null ? null : LeagueNormalizer.TrimPlayerName(name);
        if (!string.IsNullOrEmpty(nextName) && PlayerNameExists(tournament, nextName, playerId))
            throw new ArgumentException("Player names must be unique.", "name");
        var oldName = player.Name;
        var updatedPlayers = tournament.Players
            .Select(item => item.Id != playerId ? item : item with
            {
                Name = nextName ?? item.Name,
                InitialWins = initialWins is null ? item.InitialWins : Math.Max(0, initialWins.Value),
                InitialDraws = initialDraws is null ? item.InitialDraws : Math.Max(0, initialDraws.Value),
                InitialLosses = initialLosses is null ? item.InitialLosses : Math.Max(0, initialLosses.Value),
                Archetype = archetype is null ? item.Archetype : archetype.Trim()
            })
            .ToArray();
        var updatedRounds = nextName is null || nextName == oldName
            ? tournament.Rounds
            : RenameRoundEntries(tournament.Rounds, oldName, nextName);
        return WithAutomaticRoundCount(tournament with { Players = updatedPlayers, Rounds = updatedRounds });
    }

    public static LiveTournamentDocument SetPlayerPaid(LiveTournamentDocument tournament, string playerId, bool paid)
    {
        if (tournament.Stage == "round")
            throw new InvalidOperationException("Paid status is locked while a Round is in progress.");
        var player = tournament.Players.FirstOrDefault(item => item.Id == playerId)
            ?? throw new KeyNotFoundException("Player was not found.");
        return tournament with
        {
            Players = tournament.Players.Select(item => item.Id == player.Id ? item with { Paid = paid } : item).ToArray()
        };
    }

    public static LiveTournamentDocument DropPlayer(LiveTournamentDocument tournament, string playerId)
    {
        if (tournament.Stage != "standings")
            throw new InvalidOperationException("Players can only be dropped between Rounds.");
        var player = tournament.Players.FirstOrDefault(item => item.Id == playerId)
            ?? throw new KeyNotFoundException("Player was not found.");
        if (player.Dropped) throw new InvalidOperationException("Player is already dropped.");
        return tournament with
        {
            Players = tournament.Players.Select(item => item.Id == player.Id ? item with { Dropped = true } : item).ToArray()
        };
    }

    public static LiveTournamentDocument RemovePlayer(LiveTournamentDocument tournament, string playerId)
    {
        var player = tournament.Players.FirstOrDefault(item => item.Id == playerId)
            ?? throw new KeyNotFoundException("Player was not found.");
        var removed = tournament with
        {
            Players = tournament.Players.Where(item => item.Id != player.Id).ToArray()
        };
        if (tournament.Stage == "registration") return WithAutomaticRoundCount(removed);
        if (tournament.Stage == "standings" && !PlayerHasRoundEntry(tournament, player.Name)) return removed;
        throw new InvalidOperationException("Player has Round Entries and can only be dropped.");
    }

    public static LiveTournamentDocument WithAutomaticRoundCount(LiveTournamentDocument tournament)
    {
        if (tournament.CustomRoundCount || tournament.Stage != "registration") return tournament;
        return tournament with { RoundCount = LiveRules.AutoSwissRoundCount(tournament) };
    }

    public static bool PlayerHasRoundEntry(LiveTournamentDocument tournament, string playerName)
    {
        var normalizedName = LeagueNormalizer.TrimPlayerName(playerName);
        return tournament.Rounds.Any(round => round.Entries.Any(item => item.Entry switch
        {
            ByeRoundEntry bye => LeagueNormalizer.TrimPlayerName(bye.PlayerName) == normalizedName,
            MatchRoundEntry match => LeagueNormalizer.TrimPlayerName(match.Player1Name) == normalizedName
                || LeagueNormalizer.TrimPlayerName(match.Player2Name) == normalizedName,
            _ => false
        }));
    }

    public static string CoercedName(string? name)
    {
        var trimmed = (name ?? string.Empty).Trim();
        return trimmed.Length == 0 ? LiveNormalizer.DefaultName : trimmed;
    }

    private static bool PlayerNameExists(LiveTournamentDocument tournament, string normalizedName, string? excludedPlayerId) =>
        tournament.Players.Any(player => player.Id != excludedPlayerId
            && LeagueNormalizer.TrimPlayerName(player.Name).ToLowerInvariant() == normalizedName.ToLowerInvariant());

    private static IReadOnlyList<LiveTournamentRoundDocument> RenameRoundEntries(
        IReadOnlyList<LiveTournamentRoundDocument> rounds,
        string oldName,
        string newName)
    {
        var normalizedOldName = LeagueNormalizer.TrimPlayerName(oldName);
        if (normalizedOldName.Length == 0) return rounds;
        return rounds
            .Select(round => round with
            {
                Entries = round.Entries.Select(item => item.Entry switch
                {
                    ByeRoundEntry bye when LeagueNormalizer.TrimPlayerName(bye.PlayerName) == normalizedOldName =>
                        item with { Entry = bye with { PlayerName = newName } },
                    MatchRoundEntry match => item with
                    {
                        Entry = match with
                        {
                            Player1Name = LeagueNormalizer.TrimPlayerName(match.Player1Name) == normalizedOldName ? newName : match.Player1Name,
                            Player2Name = LeagueNormalizer.TrimPlayerName(match.Player2Name) == normalizedOldName ? newName : match.Player2Name
                        }
                    },
                    _ => item
                }).ToArray()
            })
            .ToArray();
    }
}
