namespace Gones.Domain.Leagues;

public static class LeagueRules
{
    public static ValidationResult Validate(RoundEntry? entry)
    {
        if (entry is null or InvalidRoundEntry) return new ValidationResult(false, ["invalidRoundEntry"]);
        if (entry is ByeRoundEntry bye)
        {
            var codes = new List<string>();
            if (LeagueNormalizer.TrimPlayerName(bye.PlayerName).Length == 0) codes.Add("playerRequired");
            if (IsReservedByeName(bye.PlayerName)) codes.Add("byeReservedPlayerName");
            return new ValidationResult(codes.Count == 0, codes);
        }

        var match = (MatchRoundEntry)entry;
        var matchCodes = new List<string>();
        var player1 = LeagueNormalizer.TrimPlayerName(match.Player1Name);
        var player2 = LeagueNormalizer.TrimPlayerName(match.Player2Name);
        if (player1.Length == 0) matchCodes.Add("playerRequired");
        if (player2.Length == 0) matchCodes.Add("opponentRequired");
        if (IsReservedByeName(player1)) matchCodes.Add("byeReservedPlayerName");
        if (IsReservedByeName(player2)) matchCodes.Add("byeReservedOpponentName");
        if (player1.Length > 0 && player2.Length > 0 && player1 == player2) matchCodes.Add("samePlayerName");
        if (match.Player1Score < 0 || match.Player2Score < 0) matchCodes.Add("resultInvalid");
        if (match.Player1Score > 2) matchCodes.Add("resultTooManyGameWins");
        if (match.Player2Score > 2) matchCodes.Add("resultTooManyGameLosses");
        return new ValidationResult(matchCodes.Count == 0, matchCodes);
    }

    public static IReadOnlyList<TournamentWarning> GetWarnings(TournamentDocument tournament)
    {
        var warnings = new List<TournamentWarning>();
        var pairings = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var knownPlayers = new HashSet<string>(StringComparer.Ordinal);
        var missingArchetypePlayers = new HashSet<string>(StringComparer.Ordinal);
        var tournamentPlayers = CollectTournamentPlayers(tournament);

        for (var roundIndex = 0; roundIndex < tournament.Rounds.Count; roundIndex++)
        {
            var round = tournament.Rounds[roundIndex];
            var seenInRound = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            var hasBye = false;
            foreach (var entry in round.Entries)
            {
                if (!Validate(entry).Valid) continue;
                var players = EntryPlayers(entry);
                if (entry is ByeRoundEntry) hasBye = true;
                foreach (var playerName in players)
                {
                    if (!seenInRound.TryGetValue(playerName, out var entryIds))
                    {
                        entryIds = [];
                        seenInRound.Add(playerName, entryIds);
                    }
                    entryIds.Add(entry.Id);
                    if (roundIndex > 0 && !knownPlayers.Contains(playerName))
                        warnings.Add(new TournamentWarning("newPlayerAfterRoundOne", round.Id, playerName, EntryIds: [entry.Id]));
                    if (PlayerArchetype(tournament, playerName).Trim().Length == 0) missingArchetypePlayers.Add(playerName);
                }
                if (entry is MatchRoundEntry match)
                {
                    var names = new[] { match.Player1Name, match.Player2Name };
                    Array.Sort(names, StringComparer.Ordinal);
                    var key = string.Join('\0', names);
                    if (!pairings.TryGetValue(key, out var entryIds))
                    {
                        entryIds = [];
                        pairings.Add(key, entryIds);
                    }
                    entryIds.Add(entry.Id);
                }
            }

            if (tournamentPlayers.Count % 2 == 1 && !hasBye && seenInRound.Count == tournamentPlayers.Count - 1)
                warnings.Add(new TournamentWarning("missingBye", round.Id));
            foreach (var item in seenInRound)
                if (item.Value.Count > 1)
                    warnings.Add(new TournamentWarning("duplicateSameRoundPlayerName", round.Id, item.Key, EntryIds: item.Value));
            foreach (var playerName in seenInRound.Keys) knownPlayers.Add(playerName);
        }

        foreach (var entryIds in pairings.Values)
            if (entryIds.Count > 1) warnings.Add(new TournamentWarning("repeatedPairing", EntryIds: entryIds));
        if (missingArchetypePlayers.Count > 0)
        {
            var playerNames = missingArchetypePlayers.ToList();
            playerNames.Sort(LeagueNormalizer.ComparePlayerNames);
            warnings.Add(new TournamentWarning("missingDeckArchetype", PlayerName: playerNames[0], PlayerNames: playerNames));
        }
        return warnings;
    }

    public static TournamentResult CalculateTournamentResult(TournamentDocument tournament)
    {
        var entries = tournament.Rounds.SelectMany(round => round.Entries).ToArray();
        var archetypes = TournamentPlayerArchetypeRows(tournament).ToDictionary(row => row.PlayerName, row => row.Archetype, StringComparer.Ordinal);
        var rows = CalculateRows(entries)
            .Select(row => row with { Archetype = archetypes.GetValueOrDefault(row.PlayerName, string.Empty) })
            .ToArray();
        var incomplete = tournament.Rounds.Count == 0 || entries.Any(entry => !Validate(entry).Valid);
        return new TournamentResult("tournament", incomplete, incomplete && rows.Length > 0, rows);
    }

    public static LeagueResult CalculateLeagueResult(LeagueDocument league)
    {
        var rows = CalculateRows(league.Tournaments.SelectMany(tournament => tournament.Rounds).SelectMany(round => round.Entries));
        var dates = league.Tournaments.Select(tournament => tournament.TournamentDate).Where(date => date.Length > 0).Order(StringComparer.Ordinal).ToArray();
        var incomplete = league.Tournaments.Any(tournament => CalculateTournamentResult(tournament).Incomplete);
        return new LeagueResult(
            "league",
            dates.FirstOrDefault() ?? string.Empty,
            dates.LastOrDefault() ?? string.Empty,
            incomplete,
            incomplete && rows.Count > 0,
            rows);
    }

    public static PlayerStatistics CalculatePlayerStatistics(GonesData data, string playerName, PlayerStatisticsFilters? filters = null)
    {
        filters ??= new PlayerStatisticsFilters();
        var selectedName = playerName ?? string.Empty;
        var playedMatchCount = 0;
        var byeCount = 0;
        var matchWins = 0;
        var gameWins = 0;
        var gameLosses = 0;
        var matches = new List<PlayerMatch>();
        var lossesByOpponent = new Dictionary<string, int>(StringComparer.Ordinal);
        var matchesByOpponent = new Dictionary<string, int>(StringComparer.Ordinal);

        foreach (var league in data.Leagues)
        {
            if (filters.LeagueId is { Length: > 0 } && league.Id != filters.LeagueId) continue;
            foreach (var tournament in league.Tournaments)
            {
                if (filters.TournamentId is { Length: > 0 } && tournament.Id != filters.TournamentId) continue;
                for (var roundIndex = 0; roundIndex < tournament.Rounds.Count; roundIndex++)
                {
                    foreach (var entry in tournament.Rounds[roundIndex].Entries)
                    {
                        if (!Validate(entry).Valid) continue;
                        if (entry is ByeRoundEntry bye && bye.PlayerName == selectedName)
                        {
                            byeCount++;
                            matches.Add(new PlayerMatch("bye", league, tournament, roundIndex, "Bye", 2, 0));
                            continue;
                        }
                        if (entry is not MatchRoundEntry match) continue;
                        var side = match.Player1Name == selectedName ? 1 : match.Player2Name == selectedName ? 2 : 0;
                        if (side == 0) continue;
                        var opponentName = side == 1 ? match.Player2Name : match.Player1Name;
                        if (filters.OpponentName is { Length: > 0 } && !IncludesNormalized(opponentName, filters.OpponentName)) continue;
                        var ownScore = side == 1 ? match.Player1Score : match.Player2Score;
                        var opponentScore = side == 1 ? match.Player2Score : match.Player1Score;
                        playedMatchCount++;
                        gameWins += ownScore;
                        gameLosses += opponentScore;
                        if (ownScore > opponentScore) matchWins++;
                        if (ownScore < opponentScore) Increment(lossesByOpponent, opponentName);
                        Increment(matchesByOpponent, opponentName);
                        matches.Add(new PlayerMatch("match", league, tournament, roundIndex, opponentName, ownScore, opponentScore));
                    }
                }
            }
        }

        return new PlayerStatistics(
            selectedName,
            playedMatchCount,
            byeCount,
            matchWins,
            gameWins,
            gameLosses,
            playedMatchCount > 0 ? (double)matchWins / playedMatchCount : null,
            gameWins + gameLosses > 0 ? (double)gameWins / (gameWins + gameLosses) : null,
            TopName(lossesByOpponent, true),
            TopName(matchesByOpponent, false),
            matches);
    }

    public static LeagueDocument RenamePlayer(LeagueDocument league, string fromName, string toName)
    {
        var from = LeagueNormalizer.TrimPlayerName(fromName);
        var to = LeagueNormalizer.TrimPlayerName(toName);
        if (from.Length == 0 || to.Length == 0 || SamePlayerName(from, to) && from == to) return league;
        return league with { Tournaments = league.Tournaments.Select(tournament => RenamePlayer(tournament, from, to)).ToArray() };
    }

    public static TournamentDocument RenamePlayer(TournamentDocument tournament, string fromName, string toName)
    {
        var from = LeagueNormalizer.TrimPlayerName(fromName);
        var to = LeagueNormalizer.TrimPlayerName(toName);
        if (from.Length == 0 || to.Length == 0) return tournament;
        return tournament with
        {
            Rounds = tournament.Rounds.Select(round => round with { Entries = round.Entries.Select(entry => RenamePlayer(entry, from, to)).ToArray() }).ToArray(),
            PlayerArchetypes = RenamePlayerArchetypes(tournament.PlayerArchetypes, from, to)
        };
    }

    public static RoundEntry RenamePlayer(RoundEntry entry, string fromName, string toName)
    {
        var from = LeagueNormalizer.TrimPlayerName(fromName);
        var to = LeagueNormalizer.TrimPlayerName(toName);
        return entry switch
        {
            MatchRoundEntry match => match with
            {
                Player1Name = SamePlayerName(match.Player1Name, from) ? to : match.Player1Name,
                Player2Name = SamePlayerName(match.Player2Name, from) ? to : match.Player2Name
            },
            ByeRoundEntry bye => bye with { PlayerName = SamePlayerName(bye.PlayerName, from) ? to : bye.PlayerName },
            InvalidRoundEntry invalid => invalid with
            {
                Player = SamePlayerName(invalid.Player, from) ? to : invalid.Player,
                Opponent = SamePlayerName(invalid.Opponent, from) ? to : invalid.Opponent
            },
            _ => entry
        };
    }

    private static IReadOnlyList<RankingRow> CalculateRows(IEnumerable<RoundEntry> entries)
    {
        var records = new Dictionary<string, MutableRankingRecord>(StringComparer.Ordinal);
        var opponentNamesByPlayer = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var entry in entries)
        {
            if (!Validate(entry).Valid) continue;
            if (entry is ByeRoundEntry bye)
            {
                var record = EnsureRecord(records, bye.PlayerName);
                record.MatchWins++;
                record.Byes++;
                record.Points += 3;
                record.MatchAssignmentCount++;
                continue;
            }
            if (entry is not MatchRoundEntry match) continue;
            var player = EnsureRecord(records, match.Player1Name);
            var opponent = EnsureRecord(records, match.Player2Name);
            player.PlayedMatchCount++;
            opponent.PlayedMatchCount++;
            player.MatchAssignmentCount++;
            opponent.MatchAssignmentCount++;
            player.GameWins += match.Player1Score;
            player.GameLosses += match.Player2Score;
            opponent.GameWins += match.Player2Score;
            opponent.GameLosses += match.Player1Score;
            AddOpponent(opponentNamesByPlayer, match.Player1Name, match.Player2Name);
            AddOpponent(opponentNamesByPlayer, match.Player2Name, match.Player1Name);
            ApplyMatchPoints(player, opponent, match);
        }

        var rows = records.Values.Select(record => new RankingRow(
            record.PlayerName,
            record.Points,
            record.MatchWins,
            record.MatchDraws,
            record.MatchLosses,
            record.Byes,
            record.PlayedMatchCount,
            record.MatchAssignmentCount,
            record.GameWins,
            record.GameLosses,
            0,
            Percentage(record.GameWins, record.GameWins + record.GameLosses) ?? 0,
            AverageOpponentPercentage(opponentNamesByPlayer.GetValueOrDefault(record.PlayerName) ?? [], records, MatchWinPercentage),
            AverageOpponentPercentage(opponentNamesByPlayer.GetValueOrDefault(record.PlayerName) ?? [], records, GameWinPercentage)))
            .ToList();
        rows.Sort(CompareRankingRows);
        return rows.Select((row, index) => row with { Rank = index + 1 }).ToArray();
    }

    private static int CompareRankingRows(RankingRow left, RankingRow right)
    {
        var result = right.Points.CompareTo(left.Points);
        if (result != 0) return result;
        result = right.OpponentsMatchWinPercentage.CompareTo(left.OpponentsMatchWinPercentage);
        if (result != 0) return result;
        result = right.GameWinPercentage.CompareTo(left.GameWinPercentage);
        if (result != 0) return result;
        result = right.OpponentsGameWinPercentage.CompareTo(left.OpponentsGameWinPercentage);
        return result != 0 ? result : LeagueNormalizer.ComparePlayerNames(left.PlayerName, right.PlayerName);
    }

    private static void ApplyMatchPoints(MutableRankingRecord player, MutableRankingRecord opponent, MatchRoundEntry entry)
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

    private static double AverageOpponentPercentage(
        IReadOnlyList<string> opponents,
        IReadOnlyDictionary<string, MutableRankingRecord> records,
        Func<MutableRankingRecord?, double?> getPercentage)
    {
        if (opponents.Count == 0) return 0;
        return opponents.Select(name => Math.Max(1d / 3d, getPercentage(records.GetValueOrDefault(name)) ?? 0)).Average();
    }

    private static double? MatchWinPercentage(MutableRankingRecord? record) =>
        record is null ? null : Percentage(record.Points, record.MatchAssignmentCount * 3);

    private static double? GameWinPercentage(MutableRankingRecord? record) =>
        record is null ? null : Percentage(record.GameWins, record.GameWins + record.GameLosses);

    private static double? Percentage(int numerator, int denominator) => denominator == 0 ? null : (double)numerator / denominator;

    private static MutableRankingRecord EnsureRecord(IDictionary<string, MutableRankingRecord> records, string playerName)
    {
        if (records.TryGetValue(playerName, out var record)) return record;
        record = new MutableRankingRecord(playerName);
        records.Add(playerName, record);
        return record;
    }

    private static void AddOpponent(IDictionary<string, List<string>> map, string playerName, string opponentName)
    {
        if (!map.TryGetValue(playerName, out var names))
        {
            names = [];
            map.Add(playerName, names);
        }
        names.Add(opponentName);
    }

    private static HashSet<string> CollectTournamentPlayers(TournamentDocument tournament)
    {
        var players = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entry in tournament.Rounds.SelectMany(round => round.Entries))
            foreach (var name in EntryPlayers(entry)) players.Add(name);
        return players;
    }

    private static IReadOnlyList<string> EntryPlayers(RoundEntry entry)
    {
        if (!Validate(entry).Valid) return [];
        return entry switch
        {
            MatchRoundEntry match => [match.Player1Name, match.Player2Name],
            ByeRoundEntry bye => [bye.PlayerName],
            _ => []
        };
    }

    private static IReadOnlyList<PlayerArchetypeDocument> TournamentPlayerArchetypeRows(TournamentDocument tournament)
    {
        var archetypes = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var item in tournament.PlayerArchetypes)
        {
            var name = LeagueNormalizer.TrimPlayerName(item.PlayerName);
            if (name.Length > 0) archetypes[name] = LeagueNormalizer.NormalizeDeckArchetype(item.Archetype);
        }
        foreach (var entry in tournament.Rounds.SelectMany(round => round.Entries))
        {
            if (!Validate(entry).Valid) continue;
            if (entry is MatchRoundEntry match)
            {
                Add(match.Player1Name, match.Player1DeckArchetype);
                Add(match.Player2Name, match.Player2DeckArchetype);
            }
            else if (entry is ByeRoundEntry bye) Add(bye.PlayerName, bye.DeckArchetype);
        }
        var rows = archetypes.Select(item => new PlayerArchetypeDocument(item.Key, item.Value)).ToList();
        rows.Sort((left, right) => LeagueNormalizer.ComparePlayerNames(left.PlayerName, right.PlayerName));
        return rows;

        void Add(string playerName, string archetype)
        {
            var name = LeagueNormalizer.TrimPlayerName(playerName);
            if (name.Length > 0 && !archetypes.ContainsKey(name)) archetypes.Add(name, LeagueNormalizer.NormalizeDeckArchetype(archetype));
        }
    }

    private static string PlayerArchetype(TournamentDocument tournament, string playerName)
    {
        var normalizedName = LeagueNormalizer.TrimPlayerName(playerName);
        var stored = tournament.PlayerArchetypes.FirstOrDefault(row => LeagueNormalizer.TrimPlayerName(row.PlayerName) == normalizedName);
        return stored?.Archetype ?? TournamentPlayerArchetypeRows(tournament).FirstOrDefault(row => row.PlayerName == normalizedName)?.Archetype ?? string.Empty;
    }

    private static IReadOnlyList<PlayerArchetypeDocument> RenamePlayerArchetypes(IReadOnlyList<PlayerArchetypeDocument> rows, string from, string to)
    {
        var displayByKey = new Dictionary<string, string>(StringComparer.Ordinal);
        var archetypeByKey = new Dictionary<string, string>(StringComparer.Ordinal);
        var toKey = LeagueNormalizer.PlayerNameKey(to);
        foreach (var row in rows)
        {
            var original = LeagueNormalizer.TrimPlayerName(row.PlayerName);
            if (original.Length == 0) continue;
            var name = SamePlayerName(original, from) ? to : original;
            var key = LeagueNormalizer.PlayerNameKey(name);
            displayByKey[key] = key == toKey ? to : name;
            var archetype = (row.Archetype ?? string.Empty).Trim();
            var existing = archetypeByKey.GetValueOrDefault(key, string.Empty);
            if (existing.Length == 0 && archetype.Length > 0) archetypeByKey[key] = archetype;
            else if (!archetypeByKey.ContainsKey(key)) archetypeByKey[key] = archetype;
        }
        var renamed = displayByKey.Select(item => new PlayerArchetypeDocument(item.Value, archetypeByKey.GetValueOrDefault(item.Key, string.Empty))).ToList();
        renamed.Sort((left, right) => LeagueNormalizer.ComparePlayerNames(left.PlayerName, right.PlayerName));
        return renamed;
    }

    private static bool SamePlayerName(string left, string right)
    {
        var a = LeagueNormalizer.PlayerNameKey(left);
        var b = LeagueNormalizer.PlayerNameKey(right);
        return a.Length > 0 && a == b;
    }

    private static bool IsReservedByeName(string value) =>
        string.Equals(LeagueNormalizer.TrimPlayerName(value), "bye", StringComparison.OrdinalIgnoreCase);

    private static bool IncludesNormalized(string value, string search) =>
        value.ToLower(System.Globalization.CultureInfo.GetCultureInfo("en-US"))
            .Contains(search.Trim().ToLower(System.Globalization.CultureInfo.GetCultureInfo("en-US")), StringComparison.Ordinal);

    private static void Increment(IDictionary<string, int> map, string name) => map[name] = (map.TryGetValue(name, out var count) ? count : 0) + 1;

    private static string? TopName(IReadOnlyDictionary<string, int> map, bool tieBreakByName)
    {
        if (map.Count == 0) return null;
        var indexed = map.Select((item, index) => (item.Key, item.Value, Index: index));
        return indexed.OrderByDescending(item => item.Value)
            .ThenBy(item => tieBreakByName ? item.Key : string.Empty, Comparer<string>.Create(LeagueNormalizer.ComparePlayerNames))
            .ThenBy(item => item.Index)
            .First().Key;
    }

    private sealed class MutableRankingRecord(string playerName)
    {
        public string PlayerName { get; } = playerName;
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
