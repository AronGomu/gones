using System.Globalization;
using System.Security.Cryptography;
using Gones.Domain.Leagues;

namespace Gones.Domain.Live;

/// <summary>
/// Exact C# port of the TypeScript Live Tournament rules in src/app/domain/live-tournament.ts.
/// ID-factory consumption order and JavaScript arithmetic are mirrored deliberately for golden parity.
/// </summary>
public static class LiveRules
{
    public static string DefaultIdFactory() => Guid.NewGuid().ToString();

    public static IReadOnlyList<LiveTournamentPlayerDocument> ActivePlayers(LiveTournamentDocument tournament) =>
        tournament.Players.Where(player => LeagueNormalizer.TrimPlayerName(player.Name).Length > 0 && !player.Dropped).ToArray();

    public static IReadOnlyList<LiveTournamentPlayerDocument> UnpaidActivePlayers(LiveTournamentDocument tournament) =>
        tournament.PaidTrackingEnabled ? ActivePlayers(tournament).Where(player => !player.Paid).ToArray() : [];

    public static int ExpectedSwissRoundCount(int playerCount)
    {
        if (playerCount < 2) return 0;
        if (playerCount == 2) return 1;
        if (playerCount <= 15) return 3;
        return (int)Math.Ceiling(Math.Log2(playerCount));
    }

    public static int AutoSwissRoundCount(LiveTournamentDocument tournament) => ExpectedSwissRoundCount(ActivePlayers(tournament).Count);

    public static bool CanStart(LiveTournamentDocument tournament) =>
        ActivePlayers(tournament).Count >= 2 && tournament.RoundCount > 0 && tournament.Stage == "registration";

    public static LiveTournamentRoundDocument? CurrentRound(LiveTournamentDocument tournament) =>
        tournament.Rounds.FirstOrDefault(round => round.RoundNumber == tournament.CurrentRoundNumber);

    public static bool CurrentRoundComplete(LiveTournamentDocument tournament)
    {
        var round = CurrentRound(tournament);
        if (round is null || round.Entries.Count == 0) return false;
        return round.Entries.All(item => item.Entry is ByeRoundEntry || MatchScoreIssue(item.Entry) is null);
    }

    public static string? MatchScoreIssue(RoundEntry entry) =>
        entry is MatchRoundEntry match ? MatchScoreIssue("match", match.Player1Score, match.Player2Score) : null;

    public static string? MatchScoreIssue(string kind, double player1Score, double player2Score)
    {
        if (kind != "match") return null;
        if (!double.IsInteger(player1Score) || !double.IsInteger(player2Score)) return "Scores must be whole numbers.";
        if (player1Score < 0 || player2Score < 0) return "Scores cannot be negative.";
        if (player1Score > 2 || player2Score > 2) return "Scores cannot be over 2 victories.";
        if (player1Score == 2 && player2Score == 2) return "Only one player can reach 2 victories.";
        return null;
    }

    public static IReadOnlyList<LiveStandingRow> CalculateStandingsThroughRound(LiveTournamentDocument tournament, int roundNumber) =>
        CalculateStandings(tournament with
        {
            Rounds = tournament.Rounds.Where(round => round.Validated && round.RoundNumber <= roundNumber).ToArray()
        });

    public static IReadOnlyList<LiveStandingRow> CalculateStandings(LiveTournamentDocument tournament)
    {
        var records = new List<MutableLiveRecord>();
        var recordsById = new Dictionary<string, MutableLiveRecord>(StringComparer.Ordinal);
        var opponentIdsByPlayer = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var player in tournament.Players)
        {
            var name = LeagueNormalizer.TrimPlayerName(player.Name);
            if (name.Length == 0) continue;
            var record = new MutableLiveRecord(player.Id, name, player.Paid, player.Dropped)
            {
                Points = player.InitialWins * 3 + player.InitialDraws,
                MatchWins = player.InitialWins,
                MatchDraws = player.InitialDraws,
                MatchLosses = player.InitialLosses,
                PlayedMatchCount = player.InitialWins + player.InitialDraws + player.InitialLosses,
                MatchAssignmentCount = player.InitialWins + player.InitialDraws + player.InitialLosses
            };
            records.Add(record);
            recordsById[player.Id] = record;
        }

        foreach (var round in tournament.Rounds.Where(item => item.Validated))
        {
            foreach (var item in round.Entries)
            {
                if (item.Entry is ByeRoundEntry bye)
                {
                    var byePlayer = FindPlayerByName(tournament, bye.PlayerName);
                    var byeRecord = byePlayer is null ? null : recordsById.GetValueOrDefault(byePlayer.Id);
                    if (byeRecord is not null)
                    {
                        byeRecord.MatchWins++;
                        byeRecord.Byes++;
                        byeRecord.Points += 3;
                        byeRecord.MatchAssignmentCount++;
                    }
                    continue;
                }
                if (item.Entry is not MatchRoundEntry match) continue;
                var player1 = FindPlayerByName(tournament, match.Player1Name);
                var player2 = FindPlayerByName(tournament, match.Player2Name);
                var record1 = player1 is null ? null : recordsById.GetValueOrDefault(player1.Id);
                var record2 = player2 is null ? null : recordsById.GetValueOrDefault(player2.Id);
                if (player1 is null || player2 is null || record1 is null || record2 is null) continue;
                record1.PlayedMatchCount++;
                record2.PlayedMatchCount++;
                record1.MatchAssignmentCount++;
                record2.MatchAssignmentCount++;
                record1.GameWins += match.Player1Score;
                record1.GameLosses += match.Player2Score;
                record2.GameWins += match.Player2Score;
                record2.GameLosses += match.Player1Score;
                AddOpponent(opponentIdsByPlayer, player1.Id, player2.Id);
                AddOpponent(opponentIdsByPlayer, player2.Id, player1.Id);
                ApplyMatchPoints(record1, record2, match);
            }
        }

        var rows = records.Select(record => new LiveStandingRow(
            0,
            record.PlayerId,
            record.PlayerName,
            record.Paid,
            record.Dropped,
            record.Points,
            record.MatchWins,
            record.MatchDraws,
            record.MatchLosses,
            record.Byes,
            record.PlayedMatchCount,
            record.MatchAssignmentCount,
            record.GameWins,
            record.GameLosses,
            Percentage(record.GameWins, record.GameWins + record.GameLosses) ?? 0,
            AverageOpponentPercentage(opponentIdsByPlayer.GetValueOrDefault(record.PlayerId) ?? [], recordsById, MatchWinPercentage),
            AverageOpponentPercentage(opponentIdsByPlayer.GetValueOrDefault(record.PlayerId) ?? [], recordsById, GameWinPercentage)));
        return rows
            .OrderBy(row => row, Comparer<LiveStandingRow>.Create(CompareStandingRows))
            .Select((row, index) => row with { Rank = index + 1 })
            .ToArray();
    }

    public static LiveTournamentDocument GenerateNextSwissRound(
        LiveTournamentDocument tournament,
        Func<string> idFactory,
        Func<long> randomSeed,
        string nowIso)
    {
        var nextRoundNumber = tournament.Rounds.Count(round => round.Validated) + 1;
        if (nextRoundNumber > tournament.RoundCount) return tournament;
        if (nextRoundNumber == 1)
        {
            var firstRound = BuildFirstRoundPairings(tournament, idFactory, randomSeed);
            var firstNormalized = NormalizeGeneratedRound(1, firstRound.Entries, idFactory);
            return Touch(tournament with
            {
                PairingSeed = firstRound.PairingSeed,
                FirstRoundPlayerOrder = firstRound.FirstRoundPlayerOrder,
                Stage = "round",
                CurrentRoundNumber = 1,
                Rounds = [firstNormalized]
            }, nowIso);
        }
        var entries = GenerateSwissPairings(tournament, idFactory);
        var nextRound = NormalizeGeneratedRound(nextRoundNumber, entries, idFactory);
        var checkpointed = tournament.Stage == "standings"
            ? WithCheckpoint(tournament, $"Standing {tournament.CurrentRoundNumber}", idFactory, nowIso)
            : tournament;
        return Touch(checkpointed with
        {
            Stage = "round",
            CurrentRoundNumber = nextRoundNumber,
            Rounds = [.. checkpointed.Rounds.Where(round => round.Validated), nextRound]
        }, nowIso);
    }

    public static LiveTournamentDocument RegenerateCurrentSwissRound(
        LiveTournamentDocument tournament,
        Func<string> idFactory,
        Func<long> randomSeed,
        string nowIso)
    {
        var round = CurrentRound(tournament);
        if (round is null || round.Validated) return tournament;
        if (round.RoundNumber == 1)
        {
            // Explicit re-roll: new seed + clear locked order, then full random first round.
            var reseeded = tournament with { PairingSeed = 0, FirstRoundPlayerOrder = [] };
            var firstRound = BuildFirstRoundPairings(reseeded, idFactory, randomSeed);
            return Touch(tournament with
            {
                PairingSeed = firstRound.PairingSeed,
                FirstRoundPlayerOrder = firstRound.FirstRoundPlayerOrder,
                Rounds = tournament.Rounds
                    .Select(item => item.Id == round.Id
                        ? LiveNormalizer.NormalizeRound(round with { Entries = firstRound.Entries }, 1, idFactory)
                        : item)
                    .ToArray()
            }, nowIso);
        }
        var seededTournament = tournament with { PairingSeed = tournament.PairingSeed + 1 };
        var entries = GenerateSwissPairings(seededTournament, idFactory);
        return Touch(seededTournament with
        {
            Rounds = tournament.Rounds
                .Select(item => item.Id == round.Id
                    ? LiveNormalizer.NormalizeRound(round with { Entries = entries }, round.RoundNumber, idFactory)
                    : item)
                .ToArray()
        }, nowIso);
    }

    public static LiveTournamentDocument CancelCurrentSwissRound(LiveTournamentDocument tournament, string nowIso)
    {
        var round = CurrentRound(tournament);
        if (round is null || round.Validated) return tournament;
        var validatedRounds = tournament.Rounds.Where(item => item.Validated).ToArray();
        // Keep pairingSeed + firstRoundPlayerOrder so a re-launch reuses the first-round generation.
        return Touch(tournament with
        {
            Stage = validatedRounds.Length > 0 ? "standings" : "registration",
            CurrentRoundNumber = validatedRounds.Length > 0 ? validatedRounds[^1].RoundNumber : 0,
            Rounds = validatedRounds
        }, nowIso);
    }

    public static LiveTournamentDocument ValidateCurrentSwissRound(
        LiveTournamentDocument tournament,
        string nowIso,
        Func<string>? idFactory = null)
    {
        idFactory ??= DefaultIdFactory;
        var round = CurrentRound(tournament);
        if (round is null || round.Validated || !CurrentRoundComplete(tournament)) return tournament;
        var checkpointed = WithCheckpoint(tournament, $"Pairing {round.RoundNumber}", idFactory, nowIso);
        return Touch(checkpointed with
        {
            Stage = "standings",
            Rounds = checkpointed.Rounds
                .Select(item => item.Id == round.Id
                    ? item with
                    {
                        Validated = true,
                        Entries = item.Entries.Select(entry => entry with { ResultEntered = true }).ToArray()
                    }
                    : item)
                .ToArray()
        }, nowIso);
    }

    public static LiveTournamentDocument UpdateRoundEntryResult(
        LiveTournamentDocument tournament,
        string roundId,
        string entryId,
        double player1Score,
        double player2Score,
        string nowIso)
    {
        return Touch(tournament with
        {
            Rounds = tournament.Rounds.Select(round => round.Id != roundId ? round : round with
            {
                Entries = round.Entries.Select(item => item.Entry is MatchRoundEntry match && match.Id == entryId
                    ? item with
                    {
                        ResultEntered = true,
                        Entry = match with
                        {
                            Player1Score = ToNonNegativeInteger(player1Score),
                            Player2Score = ToNonNegativeInteger(player2Score)
                        }
                    }
                    : item).ToArray()
            }).ToArray()
        }, nowIso);
    }

    public static LiveTournamentDocument RestoreCheckpoint(
        LiveTournamentDocument tournament,
        string checkpointId,
        string nowIso,
        Func<string>? idFactory = null)
    {
        idFactory ??= DefaultIdFactory;
        var checkpoint = tournament.Checkpoints.FirstOrDefault(item => item.Id == checkpointId);
        if (checkpoint is null || tournament.Stage == "completed") return tournament;
        var checkpointIndex = IndexOfCheckpoint(tournament.Checkpoints, checkpoint.Id);
        return Touch(tournament with
        {
            Stage = checkpoint.Stage,
            CurrentRoundNumber = checkpoint.CurrentRoundNumber,
            RoundCount = checkpoint.RoundCount,
            PaidTrackingEnabled = checkpoint.PaidTrackingEnabled,
            Players = checkpoint.Players.Select(LiveNormalizer.CreatePlayer).ToArray(),
            Rounds = checkpoint.Rounds.Select((round, index) => LiveNormalizer.NormalizeRound(round, index + 1, idFactory)).ToArray(),
            Checkpoints = checkpointIndex == -1 ? tournament.Checkpoints : tournament.Checkpoints.Take(checkpointIndex + 1).ToArray()
        }, nowIso);
    }

    public static TournamentDocument Finalize(LiveTournamentDocument tournament, Func<string> idFactory, string defaultTournamentName)
    {
        var rounds = tournament.Rounds
            .Where(round => round.Validated)
            .Select(round => CreateRound(round.Entries.Select(item => WithLivePlayerArchetypes(item.Entry, tournament)).ToArray(), idFactory))
            .ToArray();
        var name = (tournament.Name.Length > 0 ? tournament.Name : defaultTournamentName).Trim();
        return new TournamentDocument(
            tournament.FinalizedTournamentId ?? idFactory(),
            tournament.LeagueId,
            name.Length == 0 ? defaultTournamentName : name,
            tournament.TournamentDate,
            "active",
            rounds,
            NormalizePlayerArchetypeRows(LivePlayerArchetypeRows(tournament)));
    }

    public static bool Finished(LiveTournamentDocument tournament) =>
        tournament.Rounds.Count(round => round.Validated) >= tournament.RoundCount;

    /// <summary>Deterministic Fisher–Yates using mulberry32, bit-exact with the TypeScript implementation.</summary>
    public static IReadOnlyList<T> SeededShuffle<T>(IReadOnlyList<T> items, long seed)
    {
        var array = items.ToArray();
        var state = unchecked((uint)seed);
        if (state == 0) state = 1;
        for (var index = array.Length - 1; index > 0; index--)
        {
            var swapWith = (int)(NextRandom(ref state) * (index + 1));
            (array[index], array[swapWith]) = (array[swapWith], array[index]);
        }
        return array;
    }

    public static long CreatePairingSeed()
    {
        var value = BitConverter.ToUInt32(RandomNumberGenerator.GetBytes(4));
        return value == 0 ? 1 : value;
    }

    private static double NextRandom(ref uint state)
    {
        state = unchecked(state + 0x6d2b79f5u);
        var t = state;
        t = unchecked((uint)((int)(t ^ (t >> 15)) * (int)(t | 1u)));
        var inner = unchecked((uint)((int)(t ^ (t >> 7)) * (int)(t | 61u)));
        t = unchecked(t ^ (t + inner));
        return (t ^ (t >> 14)) / 4294967296d;
    }

    private static long MixSeed(long seed, int salt)
    {
        var mixed = unchecked((uint)seed ^ (uint)((salt + 1) * (int)0x9e3779b9));
        return mixed == 0 ? 1 : mixed;
    }

    private static int IndexOfCheckpoint(IReadOnlyList<LiveTournamentCheckpointDocument> checkpoints, string checkpointId)
    {
        for (var index = 0; index < checkpoints.Count; index++)
        {
            if (checkpoints[index].Id == checkpointId) return index;
        }
        return -1;
    }

    private sealed record FirstRoundPairings(
        IReadOnlyList<LiveTournamentRoundEntryDocument> Entries,
        long PairingSeed,
        IReadOnlyList<string> FirstRoundPlayerOrder);

    private static FirstRoundPairings BuildFirstRoundPairings(
        LiveTournamentDocument tournament,
        Func<string> idFactory,
        Func<long> randomSeed)
    {
        var active = ActivePlayers(tournament);
        var activeById = active.ToDictionary(player => player.Id, StringComparer.Ordinal);
        var lockedOrder = LiveNormalizer.NormalizePlayerIdList(tournament.FirstRoundPlayerOrder)
            .Where(activeById.ContainsKey)
            .ToArray();
        var lockedSet = new HashSet<string>(lockedOrder, StringComparer.Ordinal);
        var newcomers = active.Where(player => !lockedSet.Contains(player.Id)).ToArray();

        // Fresh launch (or no locked cohort yet): randomize everyone with a new/non-zero seed.
        if (tournament.PairingSeed == 0 || lockedOrder.Length == 0)
        {
            var freshSeed = tournament.PairingSeed != 0 ? tournament.PairingSeed : randomSeed();
            var order = SeededShuffle(active.Select(player => player.Id).ToArray(), freshSeed);
            return new FirstRoundPairings(EntriesFromPlayerOrder(order, activeById, idFactory), freshSeed, order);
        }

        var pairingSeed = tournament.PairingSeed;

        // Same roster re-launch after cancel: rebuild exact prior order.
        if (newcomers.Length == 0)
        {
            return new FirstRoundPairings(EntriesFromPlayerOrder(lockedOrder, activeById, idFactory), pairingSeed, lockedOrder);
        }

        // One new player: play previous bye if any, otherwise take the bye. Never reshuffle locked pairings.
        if (newcomers.Length == 1)
        {
            var newPlayerId = newcomers[0].Id;
            string[] nextOrder;
            if (lockedOrder.Length % 2 == 1)
            {
                var byePlayerId = lockedOrder[^1];
                nextOrder = [.. lockedOrder[..^1], byePlayerId, newPlayerId];
            }
            else
            {
                nextOrder = [.. lockedOrder, newPlayerId];
            }
            return new FirstRoundPairings(EntriesFromPlayerOrder(nextOrder, activeById, idFactory), pairingSeed, nextOrder);
        }

        // Multiple new players: keep locked pairings/bye intact; only pair newcomers among themselves.
        var newOrder = SeededShuffle(newcomers.Select(player => player.Id).ToArray(), MixSeed(pairingSeed, newcomers.Length));
        var lockedEntries = EntriesFromPlayerOrder(lockedOrder, activeById, idFactory);
        var newEntries = EntriesFromPlayerOrder(newOrder, activeById, idFactory, lockedEntries.Count);
        return new FirstRoundPairings(
            SortEntriesByTable(lockedEntries.Concat(newEntries)),
            pairingSeed,
            [.. lockedOrder, .. newOrder]);
    }

    private static IReadOnlyList<LiveTournamentRoundEntryDocument> EntriesFromPlayerOrder(
        IReadOnlyList<string> order,
        IReadOnlyDictionary<string, LiveTournamentPlayerDocument> activeById,
        Func<string> idFactory,
        int tableOffset = 0)
    {
        var ids = order.Where(activeById.ContainsKey).ToList();
        var entries = new List<LiveTournamentRoundEntryDocument>();
        var table = tableOffset + 1;
        string? byeId = null;
        if (ids.Count % 2 == 1)
        {
            byeId = ids[^1];
            ids.RemoveAt(ids.Count - 1);
        }

        while (ids.Count >= 2)
        {
            var player1 = activeById[Shift(ids)];
            var player2 = activeById[Shift(ids)];
            entries.Add(new LiveTournamentRoundEntryDocument(
                new MatchRoundEntry(
                    idFactory(),
                    JsNumberToString(table++),
                    LeagueNormalizer.TrimPlayerName(player1.Name),
                    LeagueNormalizer.TrimPlayerName(player2.Name),
                    0,
                    0,
                    string.Empty,
                    string.Empty),
                false));
        }

        if (byeId is not null)
        {
            var byePlayer = activeById[byeId];
            entries.Add(new LiveTournamentRoundEntryDocument(
                new ByeRoundEntry(idFactory(), JsNumberToString(table), LeagueNormalizer.TrimPlayerName(byePlayer.Name), string.Empty),
                true));
        }

        return entries;
    }

    private static IReadOnlyList<LiveTournamentRoundEntryDocument> GenerateSwissPairings(
        LiveTournamentDocument tournament,
        Func<string> idFactory)
    {
        var standings = CalculateStandings(tournament);
        var activeIds = new HashSet<string>(ActivePlayers(tournament).Select(player => player.Id), StringComparer.Ordinal);
        var players = standings.Where(row => activeIds.Contains(row.PlayerId)).ToList();
        var entries = new List<LiveTournamentRoundEntryDocument>();
        var table = 1;

        if (players.Count % 2 == 1)
        {
            var byeIndex = FindByeCandidateIndex(players, tournament);
            var byePlayer = players[byeIndex];
            players.RemoveAt(byeIndex);
            entries.Add(new LiveTournamentRoundEntryDocument(
                new ByeRoundEntry(
                    idFactory(),
                    JsNumberToString((int)Math.Ceiling(players.Count / 2d) + 1),
                    LeagueNormalizer.TrimPlayerName(byePlayer.PlayerName),
                    string.Empty),
                true));
        }

        while (players.Count >= 2)
        {
            var player = players[0];
            players.RemoveAt(0);
            var opponentIndex = FindOpponentIndex(player.PlayerName, players, tournament);
            var opponent = players[opponentIndex];
            players.RemoveAt(opponentIndex);
            entries.Add(new LiveTournamentRoundEntryDocument(
                new MatchRoundEntry(
                    idFactory(),
                    JsNumberToString(table++),
                    LeagueNormalizer.TrimPlayerName(player.PlayerName),
                    LeagueNormalizer.TrimPlayerName(opponent.PlayerName),
                    0,
                    0,
                    string.Empty,
                    string.Empty),
                false));
        }

        return SortEntriesByTable(entries);
    }

    private static LiveTournamentRoundDocument NormalizeGeneratedRound(
        int roundNumber,
        IReadOnlyList<LiveTournamentRoundEntryDocument> entries,
        Func<string> idFactory)
    {
        // Mirrors normalizeLiveRound({ roundNumber, entries, validated: false }, roundNumber, { idFactory }).
        return new LiveTournamentRoundDocument(
            idFactory(),
            roundNumber,
            entries.Select(LiveNormalizer.NormalizeRoundEntry).ToArray(),
            false);
    }

    private static LiveTournamentDocument WithCheckpoint(
        LiveTournamentDocument tournament,
        string label,
        Func<string> idFactory,
        string nowIso)
    {
        if (tournament.Stage is not ("round" or "standings")) return tournament;
        var checkpoint = LiveNormalizer.NormalizeCheckpoint(
            new LiveTournamentCheckpointDocument(
                idFactory(),
                label,
                nowIso,
                tournament.Stage,
                tournament.CurrentRoundNumber,
                tournament.RoundCount,
                tournament.PaidTrackingEnabled,
                tournament.Players,
                tournament.Rounds),
            idFactory,
            nowIso);
        return tournament with
        {
            Checkpoints = tournament.Checkpoints.Append(checkpoint).TakeLast(LiveNormalizer.MaximumCheckpoints).ToArray()
        };
    }

    private static IReadOnlyList<PlayerArchetypeDocument> LivePlayerArchetypeRows(LiveTournamentDocument tournament)
    {
        var rows = tournament.Players
            .Select(player => new PlayerArchetypeDocument(
                LeagueNormalizer.TrimPlayerName(player.Name),
                (player.Archetype ?? string.Empty).Trim()))
            .Where(row => row.PlayerName.Length > 0)
            .ToList();
        rows.Sort((left, right) => LeagueNormalizer.ComparePlayerNames(left.PlayerName, right.PlayerName));
        return rows;
    }

    private static IReadOnlyList<PlayerArchetypeDocument> NormalizePlayerArchetypeRows(IReadOnlyList<PlayerArchetypeDocument> archetypes)
    {
        // Mirrors normalizePlayerArchetypeDocuments from models.ts.
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var normalized = new List<PlayerArchetypeDocument>();
        foreach (var item in archetypes)
        {
            var playerName = LeagueNormalizer.TrimPlayerName(item.PlayerName);
            if (playerName.Length == 0 || !seen.Add(playerName)) continue;
            normalized.Add(new PlayerArchetypeDocument(playerName, LeagueNormalizer.NormalizeDeckArchetype(item.Archetype)));
        }
        normalized.Sort((left, right) => LeagueNormalizer.ComparePlayerNames(left.PlayerName, right.PlayerName));
        return normalized;
    }

    private static RoundEntry WithLivePlayerArchetypes(RoundEntry entry, LiveTournamentDocument tournament) => entry switch
    {
        MatchRoundEntry match => match with
        {
            Player1DeckArchetype = ArchetypeForPlayer(tournament, match.Player1Name),
            Player2DeckArchetype = ArchetypeForPlayer(tournament, match.Player2Name)
        },
        ByeRoundEntry bye => bye with { DeckArchetype = ArchetypeForPlayer(tournament, bye.PlayerName) },
        _ => entry
    };

    private static string ArchetypeForPlayer(LiveTournamentDocument tournament, string playerName)
    {
        var normalizedName = LeagueNormalizer.TrimPlayerName(playerName);
        var player = tournament.Players.FirstOrDefault(item => LeagueNormalizer.TrimPlayerName(item.Name) == normalizedName);
        return player?.Archetype?.Trim() ?? string.Empty;
    }

    private static RoundDocument CreateRound(IReadOnlyList<RoundEntry> entries, Func<string> idFactory)
    {
        // Mirrors createRound from models.ts: round ID first, then entry normalization with table fallbacks.
        var id = idFactory();
        return new RoundDocument(
            id,
            entries.Select((entry, index) => CreateRoundEntry(WithDefaultTable(entry, JsNumberToString(index + 1)))).ToArray());
    }

    private static RoundEntry WithDefaultTable(RoundEntry entry, string fallbackTable) => entry switch
    {
        MatchRoundEntry match => match with { Table = match.Table.Length > 0 ? match.Table : fallbackTable },
        ByeRoundEntry bye => bye with { Table = bye.Table.Length > 0 ? bye.Table : fallbackTable },
        InvalidRoundEntry invalid => invalid with { Table = invalid.Table.Length > 0 ? invalid.Table : fallbackTable },
        _ => entry
    };

    private static RoundEntry CreateRoundEntry(RoundEntry entry) => entry switch
    {
        MatchRoundEntry match => match with
        {
            Player1Name = LeagueNormalizer.TrimPlayerName(match.Player1Name),
            Player2Name = LeagueNormalizer.TrimPlayerName(match.Player2Name),
            Player1Score = Math.Max(0, match.Player1Score),
            Player2Score = Math.Max(0, match.Player2Score),
            Player1DeckArchetype = LeagueNormalizer.NormalizeDeckArchetype(match.Player1DeckArchetype),
            Player2DeckArchetype = LeagueNormalizer.NormalizeDeckArchetype(match.Player2DeckArchetype)
        },
        ByeRoundEntry bye => bye with
        {
            PlayerName = LeagueNormalizer.TrimPlayerName(bye.PlayerName),
            DeckArchetype = LeagueNormalizer.NormalizeDeckArchetype(bye.DeckArchetype)
        },
        InvalidRoundEntry invalid => invalid with
        {
            Player = LeagueNormalizer.TrimPlayerName(invalid.Player),
            Opponent = LeagueNormalizer.TrimPlayerName(invalid.Opponent)
        },
        _ => entry
    };

    private static IReadOnlyList<LiveTournamentRoundEntryDocument> SortEntriesByTable(IEnumerable<LiveTournamentRoundEntryDocument> entries) =>
        entries.OrderBy(item => JsTableNumber(item.Entry.Table)).ToArray();

    private static double JsTableNumber(string table)
    {
        if (string.IsNullOrEmpty(table)) return 0;
        var trimmed = table.Trim();
        if (trimmed.Length == 0) return 0;
        return double.TryParse(trimmed, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) ? value : double.NaN;
    }

    private static string JsNumberToString(int value) => value.ToString(CultureInfo.InvariantCulture);

    private static int FindOpponentIndex(string playerName, IReadOnlyList<LiveStandingRow> candidates, LiveTournamentDocument tournament)
    {
        for (var index = 0; index < candidates.Count; index++)
        {
            if (!HavePlayed(tournament, playerName, candidates[index].PlayerName)) return index;
        }
        return 0;
    }

    private static int FindByeCandidateIndex(IReadOnlyList<LiveStandingRow> players, LiveTournamentDocument tournament)
    {
        for (var index = players.Count - 1; index >= 0; index--)
        {
            if (!HasHadBye(tournament, players[index].PlayerName)) return index;
        }
        return players.Count - 1;
    }

    private static bool HavePlayed(LiveTournamentDocument tournament, string left, string right) =>
        tournament.Rounds.Any(round => round.Validated && round.Entries.Any(item =>
            item.Entry is MatchRoundEntry match && SamePair(match.Player1Name, match.Player2Name, left, right)));

    private static bool SamePair(string a, string b, string left, string right) =>
        (a == left && b == right) || (a == right && b == left);

    private static bool HasHadBye(LiveTournamentDocument tournament, string playerName) =>
        tournament.Rounds.Any(round => round.Validated && round.Entries.Any(item =>
            item.Entry is ByeRoundEntry bye && bye.PlayerName == playerName));

    private static LiveTournamentPlayerDocument? FindPlayerByName(LiveTournamentDocument tournament, string playerName)
    {
        var normalized = LeagueNormalizer.TrimPlayerName(playerName);
        return tournament.Players.FirstOrDefault(player => LeagueNormalizer.TrimPlayerName(player.Name) == normalized);
    }

    private static void ApplyMatchPoints(MutableLiveRecord player, MutableLiveRecord opponent, MatchRoundEntry entry)
    {
        if (entry.Player1Score > entry.Player2Score)
        {
            player.MatchWins++;
            opponent.MatchLosses++;
            player.Points += 3;
        }
        else if (entry.Player2Score > entry.Player1Score)
        {
            opponent.MatchWins++;
            player.MatchLosses++;
            opponent.Points += 3;
        }
        else
        {
            player.MatchDraws++;
            opponent.MatchDraws++;
            player.Points++;
            opponent.Points++;
        }
    }

    private static void AddOpponent(IDictionary<string, List<string>> map, string playerId, string opponentId)
    {
        if (!map.TryGetValue(playerId, out var opponents))
        {
            opponents = [];
            map[playerId] = opponents;
        }
        opponents.Add(opponentId);
    }

    // Live-only extra tiebreak: MatchWins before PlayerName. Intentional divergence from LeagueRules.CompareRankingRows — see docs/CONTEXT.md ranking contract; pinned by LiveArchiveTiebreakTests.
    private static int CompareStandingRows(LiveStandingRow left, LiveStandingRow right)
    {
        var result = right.Points.CompareTo(left.Points);
        if (result != 0) return result;
        result = right.OpponentsMatchWinPercentage.CompareTo(left.OpponentsMatchWinPercentage);
        if (result != 0) return result;
        result = right.GameWinPercentage.CompareTo(left.GameWinPercentage);
        if (result != 0) return result;
        result = right.OpponentsGameWinPercentage.CompareTo(left.OpponentsGameWinPercentage);
        if (result != 0) return result;
        result = right.MatchWins.CompareTo(left.MatchWins);
        return result != 0 ? result : LeagueNormalizer.ComparePlayerNames(left.PlayerName, right.PlayerName);
    }

    private static double AverageOpponentPercentage(
        IReadOnlyList<string> opponentIds,
        IReadOnlyDictionary<string, MutableLiveRecord> records,
        Func<MutableLiveRecord?, double?> getPercentage)
    {
        if (opponentIds.Count == 0) return 0;
        return opponentIds.Select(playerId => Math.Max(1d / 3d, getPercentage(records.GetValueOrDefault(playerId)) ?? 0)).Average();
    }

    private static double? MatchWinPercentage(MutableLiveRecord? record) =>
        record is null ? null : Percentage(record.Points, record.MatchAssignmentCount * 3);

    private static double? GameWinPercentage(MutableLiveRecord? record) =>
        record is null ? null : Percentage(record.GameWins, record.GameWins + record.GameLosses);

    private static double? Percentage(int numerator, int denominator) => denominator == 0 ? null : (double)numerator / denominator;

    private static string Shift(List<string> ids)
    {
        var value = ids[0];
        ids.RemoveAt(0);
        return value;
    }

    private static LiveTournamentDocument Touch(LiveTournamentDocument tournament, string nowIso) =>
        tournament with { UpdatedAt = nowIso };

    private static int ToNonNegativeInteger(double value) =>
        double.IsInteger(value) && value >= 0 ? (int)value : 0;

    private sealed class MutableLiveRecord(string playerId, string playerName, bool paid, bool dropped)
    {
        public string PlayerId { get; } = playerId;
        public string PlayerName { get; } = playerName;
        public bool Paid { get; } = paid;
        public bool Dropped { get; } = dropped;
        public int Points { get; set; }
        public int MatchWins { get; set; }
        public int MatchDraws { get; set; }
        public int MatchLosses { get; set; }
        public int Byes { get; set; }
        public int PlayedMatchCount { get; set; }
        public int MatchAssignmentCount { get; set; }
        public int GameWins { get; set; }
        public int GameLosses { get; set; }
    }
}
