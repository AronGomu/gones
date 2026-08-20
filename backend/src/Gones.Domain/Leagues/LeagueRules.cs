using System.Globalization;

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
        var accumulator = new StatisticsAccumulator(LeagueNormalizer.TrimPlayerName(playerName ?? string.Empty));
        foreach (var league in data.Leagues) CollectLeagueStatistics(accumulator, league, filters);
        return FinalizeStatistics(accumulator);
    }

    /// <param name="asOf">
    /// The rebuild clock, which only the rating reads: idle deviation growth and the decayed rating are
    /// measured from a player's last played date to this day. Defaults to today in UTC. It is a date and
    /// not an instant because the idle span is counted in whole months, so a rebuild run twice on the
    /// same day produces byte-identical rows.
    /// </param>
    public static IReadOnlyList<GlobalPlayerStatistics> CalculateGlobalPlayerStatistics(GonesData data, DateOnly? asOf = null)
    {
        var accumulators = new Dictionary<string, StatisticsAccumulator>(StringComparer.Ordinal);
        foreach (var league in data.Leagues)
        {
            foreach (var tournament in league.Tournaments)
            {
                // ADR 0040: scope is the Tournament, not the League. A played Match is history, and an
                // archive is complete per Tournament, not per season — an active League that already ran
                // a completed Tournament contributes it, and a completed League never drags an
                // unfinished Tournament in with it.
                if (tournament.Status != "completed") continue;
                for (var roundIndex = 0; roundIndex < tournament.Rounds.Count; roundIndex++)
                {
                    foreach (var entry in tournament.Rounds[roundIndex].Entries)
                    {
                        if (entry is not MatchRoundEntry match || !Validate(match).Valid) continue;
                        CollectMatchStatistics(EnsureAccumulator(match.Player1Name), match, 1, league, tournament, roundIndex);
                        CollectMatchStatistics(EnsureAccumulator(match.Player2Name), match, 2, league, tournament, roundIndex);
                    }
                }
            }
        }

        var ratings = ReplayRatings(data, asOf ?? DateOnly.FromDateTime(DateTime.UtcNow));

        return accumulators.Values
            .Select(FinalizeStatistics)
            .Where(stats => stats.PlayedMatchCount > 0)
            .Select(stats => Project(stats, ratings.GetValueOrDefault(stats.PlayerName)))
            .OrderBy(stats => stats.PlayerName, StringComparer.Ordinal)
            .ToArray();

        StatisticsAccumulator EnsureAccumulator(string playerName)
        {
            var name = LeagueNormalizer.TrimPlayerName(playerName);
            if (accumulators.TryGetValue(name, out var accumulator)) return accumulator;
            accumulator = new StatisticsAccumulator(name);
            accumulators.Add(name, accumulator);
            return accumulator;
        }
    }

    /// <summary>
    /// Joins the ADR 0040 counting pass to the ADR 0043 rating. A player with no rated Match — byes only,
    /// or nothing but 0-0 — has no replay state and keeps the published seed.
    /// </summary>
    private static GlobalPlayerStatistics Project(PlayerStatistics stats, RatingState? rating) => new(
        stats.PlayerName,
        stats.PlayedMatchCount,
        stats.MatchWins,
        stats.MatchLosses,
        stats.MatchDraws,
        stats.MatchWinrate,
        stats.PlayedGameCount,
        stats.GameWins,
        stats.GameLosses,
        stats.GameWinrate,
        stats.Nemesis,
        stats.Rival,
        stats.MostPlayedArchetype,
        rating?.Rating.Rating ?? Glicko2.Seed.Rating,
        rating?.Rating.Deviation ?? Glicko2.Seed.Deviation,
        rating?.Rating.Volatility ?? Glicko2.Seed.Volatility,
        rating?.PreviousRating ?? Glicko2.Seed.Rating,
        rating is null ? 0.0 : rating.Rating.Rating - rating.PreviousRating,
        rating?.Tournaments.Count ?? 0,
        rating?.LastPlayedDate,
        rating?.DecayedRating ?? Glicko2.Seed.Rating);

    /// <summary>
    /// Replays every completed Tournament as Glicko-2 (ADR 0043). The rules, in the order they run:
    ///
    /// <list type="number">
    /// <item><description>Collect every completed Tournament (<c>Status == "completed"</c>) from every League.</description></item>
    /// <item><description>Group them by <c>TournamentDate</c>. A Tournament with an empty date is skipped
    /// by the rating — it still counts in the statistics above. Dates replay ascending,
    /// <see cref="StringComparer.Ordinal"/>, which is date order for ISO strings.</description></item>
    /// <item><description>Each date is one rating period: every valid <see cref="MatchRoundEntry"/> in every
    /// Tournament on that date, in document order. <see cref="ByeRoundEntry"/> is skipped entirely, and so
    /// is a Match scored 0-0.</description></item>
    /// <item><description>Every Match in the period is evaluated against the ratings held <b>before</b> the
    /// period started. That is what makes Match order inside a period, and Tournament order inside a date,
    /// irrelevant — which matters because <c>tournamentDate</c> carries no clock.</description></item>
    /// <item><description>Each player in the period gets exactly one <see cref="Glicko2.Update"/>, carrying
    /// one <see cref="Glicko2Result"/> per Match.</description></item>
    /// <item><description>A player not in the period is left untouched — no <see cref="Glicko2.Skip"/>.
    /// Idle growth happens once, in rule 8, so a rating does not depend on how many dates happened to exist
    /// between two appearances in a partially-populated archive.</description></item>
    /// <item><description><c>PreviousRating</c> is the rating held before the player's most recent period,
    /// <c>LastPlayedDate</c> is that period's date, and <c>TournamentsPlayed</c> counts the distinct
    /// completed Tournaments the player had a rated Match in.</description></item>
    /// <item><description>After the last period, idle growth is applied once per player:
    /// <see cref="Glicko2.Skip"/> repeated once per whole month since <c>LastPlayedDate</c>, capped at 24
    /// applications (the deviation is clamped at 350 anyway, so the cap only bounds the loop). The decayed
    /// rating uses the same month count.</description></item>
    /// <item><description>A player with zero rated Matches gets no state at all and keeps
    /// <see cref="Glicko2.Seed"/> with <c>TournamentsPlayed = 0</c> — see <see cref="Project"/>.</description></item>
    /// </list>
    /// </summary>
    private static Dictionary<string, RatingState> ReplayRatings(GonesData data, DateOnly asOf)
    {
        var periods = new SortedDictionary<string, List<RatedMatch>>(StringComparer.Ordinal);
        foreach (var league in data.Leagues)
        {
            foreach (var tournament in league.Tournaments)
            {
                if (tournament.Status != "completed" || tournament.TournamentDate.Length == 0) continue;
                foreach (var round in tournament.Rounds)
                {
                    foreach (var entry in round.Entries)
                    {
                        if (entry is not MatchRoundEntry match || !Validate(match).Valid) continue;
                        // 0-0 is byte-identical to a Match nobody scored. Scoring it would invent a result.
                        if (match is { Player1Score: 0, Player2Score: 0 }) continue;
                        if (!periods.TryGetValue(tournament.TournamentDate, out var matches))
                        {
                            matches = [];
                            periods.Add(tournament.TournamentDate, matches);
                        }
                        matches.Add(new RatedMatch($"{league.Id}\u0000{tournament.Id}", match));
                    }
                }
            }
        }

        var states = new Dictionary<string, RatingState>(StringComparer.Ordinal);
        foreach (var (date, matches) in periods)
        {
            // Insertion-ordered alongside the dictionary: Dictionary does not promise an enumeration
            // order, and the rating has to be reproducible down to the last bit.
            var participants = new List<string>();
            var results = new Dictionary<string, List<Glicko2Result>>(StringComparer.Ordinal);
            foreach (var (tournamentKey, match) in matches)
            {
                var player1 = EnsureState(LeagueNormalizer.TrimPlayerName(match.Player1Name));
                var player2 = EnsureState(LeagueNormalizer.TrimPlayerName(match.Player2Name));
                // Read both ratings before either list is touched: rule 4, the whole period sees the same
                // starting state.
                var before1 = player1.Rating;
                var before2 = player2.Rating;
                Record(player1, before2, match.Player1Score, match.Player2Score);
                Record(player2, before1, match.Player2Score, match.Player1Score);
                player1.Tournaments.Add(tournamentKey);
                player2.Tournaments.Add(tournamentKey);
            }

            foreach (var playerName in participants)
            {
                var state = states[playerName];
                state.PreviousRating = state.Rating.Rating;
                state.Rating = Glicko2.Update(state.Rating, results[playerName]);
                state.LastPlayedDate = date;
            }

            void Record(RatingState state, Glicko2Rating opponent, int ownScore, int opponentScore)
            {
                if (!results.TryGetValue(state.PlayerName, out var list))
                {
                    list = [];
                    results.Add(state.PlayerName, list);
                    participants.Add(state.PlayerName);
                }
                list.Add(new Glicko2Result(
                    opponent,
                    MarginOfVictory.Score(ownScore, opponentScore),
                    MarginOfVictory.Factor(ownScore, opponentScore)));
            }
        }

        foreach (var state in states.Values)
        {
            var idleMonths = IdleMonths(state.LastPlayedDate, asOf);
            for (var month = 0; month < Math.Min(idleMonths, MaximumIdleSkips); month++) state.Rating = Glicko2.Skip(state.Rating);
            state.DecayedRating = Glicko2Decay.Apply(state.Rating.Rating, idleMonths);
        }

        return states;

        RatingState EnsureState(string playerName)
        {
            if (states.TryGetValue(playerName, out var state)) return state;
            state = new RatingState(playerName);
            states.Add(playerName, state);
            return state;
        }
    }

    /// <summary>
    /// Whole months from a played date to the rebuild clock, never negative. A date the archive holds but
    /// no calendar recognises reads as zero: the rating already replayed it in ordinal order, and guessing
    /// an idle span from an unparseable string would be worse than not decaying at all.
    /// </summary>
    private static int IdleMonths(string? lastPlayedDate, DateOnly asOf)
    {
        if (!DateOnly.TryParseExact(lastPlayedDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var played)) return 0;
        var months = ((asOf.Year - played.Year) * 12) + asOf.Month - played.Month;
        if (asOf.Day < played.Day) months--;
        return Math.Max(months, 0);
    }

    /// <summary>The deviation is clamped at 350, so this only bounds the loop.</summary>
    private const int MaximumIdleSkips = 24;

    private readonly record struct RatedMatch(string TournamentKey, MatchRoundEntry Match);

    private sealed class RatingState(string playerName)
    {
        public string PlayerName { get; } = playerName;
        public Glicko2Rating Rating { get; set; } = Glicko2.Seed;
        public double PreviousRating { get; set; } = Glicko2.Seed.Rating;
        public double DecayedRating { get; set; } = Glicko2.Seed.Rating;
        public string? LastPlayedDate { get; set; }
        public HashSet<string> Tournaments { get; } = new(StringComparer.Ordinal);
    }

    private static void CollectLeagueStatistics(StatisticsAccumulator accumulator, LeagueDocument league, PlayerStatisticsFilters filters)
    {
        if (filters.LeagueId is { Length: > 0 } && league.Id != filters.LeagueId) return;
        foreach (var tournament in league.Tournaments)
        {
            if (filters.TournamentId is { Length: > 0 } && tournament.Id != filters.TournamentId) continue;
            for (var roundIndex = 0; roundIndex < tournament.Rounds.Count; roundIndex++)
            {
                foreach (var entry in tournament.Rounds[roundIndex].Entries)
                {
                    if (!Validate(entry).Valid) continue;
                    if (entry is ByeRoundEntry bye && LeagueNormalizer.TrimPlayerName(bye.PlayerName) == accumulator.PlayerName)
                    {
                        accumulator.ByeCount++;
                        accumulator.Matches.Add(new PlayerMatch("bye", league, tournament, roundIndex, "Bye", 2, 0));
                        continue;
                    }
                    if (entry is not MatchRoundEntry match) continue;
                    var side = LeagueNormalizer.TrimPlayerName(match.Player1Name) == accumulator.PlayerName ? 1 : LeagueNormalizer.TrimPlayerName(match.Player2Name) == accumulator.PlayerName ? 2 : 0;
                    if (side == 0) continue;
                    var opponentName = LeagueNormalizer.TrimPlayerName(side == 1 ? match.Player2Name : match.Player1Name);
                    if (filters.OpponentName is { Length: > 0 } && !IncludesNormalized(opponentName, filters.OpponentName)) continue;
                    CollectMatchStatistics(accumulator, match, side, league, tournament, roundIndex);
                }
            }
        }
    }

    private static void CollectMatchStatistics(StatisticsAccumulator accumulator, MatchRoundEntry match, int side, LeagueDocument league, TournamentDocument tournament, int roundIndex)
    {
        var opponentName = LeagueNormalizer.TrimPlayerName(side == 1 ? match.Player2Name : match.Player1Name);
        var ownScore = side == 1 ? match.Player1Score : match.Player2Score;
        var opponentScore = side == 1 ? match.Player2Score : match.Player1Score;
        if (!accumulator.Opponents.TryGetValue(opponentName, out var opponent))
        {
            opponent = new MutableOpponentRecord(opponentName);
            accumulator.Opponents.Add(opponentName, opponent);
        }
        accumulator.PlayedMatchCount++;
        accumulator.GameWins += ownScore;
        accumulator.GameLosses += opponentScore;
        if (ownScore > opponentScore)
        {
            accumulator.MatchWins++;
            opponent.Wins++;
        }
        else if (ownScore < opponentScore)
        {
            accumulator.MatchLosses++;
            opponent.Losses++;
        }
        else accumulator.MatchDraws++;
        opponent.MatchCount++;
        var archetype = SelectedArchetype(match, side, tournament, accumulator.PlayerName);
        if (archetype.Length > 0) accumulator.Archetypes[archetype] = accumulator.Archetypes.GetValueOrDefault(archetype) + 1;
        accumulator.Matches.Add(new PlayerMatch("match", league, tournament, roundIndex, opponentName, ownScore, opponentScore));
    }

    private static PlayerStatistics FinalizeStatistics(StatisticsAccumulator accumulator)
    {
        var playedGameCount = accumulator.GameWins + accumulator.GameLosses;
        return new PlayerStatistics(
            accumulator.PlayerName,
            accumulator.PlayedMatchCount,
            accumulator.ByeCount,
            accumulator.MatchWins,
            accumulator.MatchLosses,
            accumulator.MatchDraws,
            playedGameCount,
            accumulator.GameWins,
            accumulator.GameLosses,
            accumulator.PlayedMatchCount > 0 ? (double)accumulator.MatchWins / accumulator.PlayedMatchCount : null,
            playedGameCount > 0 ? (double)accumulator.GameWins / playedGameCount : null,
            TopOpponent(accumulator.Opponents, record => record.Losses, true),
            TopOpponent(accumulator.Opponents, record => record.MatchCount),
            TopArchetype(accumulator.Archetypes),
            accumulator.Matches);
    }

    private static OpponentRecord? TopOpponent(IReadOnlyDictionary<string, MutableOpponentRecord> map, Func<MutableOpponentRecord, int> value, bool requirePositive = false)
    {
        var top = map.Values
            .Where(record => !requirePositive || value(record) > 0)
            .OrderByDescending(value)
            .ThenBy(record => record.Name, StringComparer.Ordinal)
            .FirstOrDefault();
        return top is null ? null : new OpponentRecord(top.Name, top.Wins, top.Losses);
    }

    private static PlayerArchetypeUsage? TopArchetype(IReadOnlyDictionary<string, int> map)
    {
        var top = map.OrderByDescending(item => item.Value).ThenBy(item => item.Key, StringComparer.Ordinal).FirstOrDefault();
        return top.Key is null ? null : new PlayerArchetypeUsage(top.Key, top.Value);
    }

    /// <summary>
    /// The archetype one side of a Match played with: the entry's own value first, then the Tournament
    /// roster, then empty. Public because the cross-League player history serves the same precedence.
    /// </summary>
    public static string SelectedArchetype(MatchRoundEntry match, int side, TournamentDocument tournament, string playerName)
    {
        var matchArchetype = (side == 1 ? match.Player1DeckArchetype : match.Player2DeckArchetype).Trim();
        return matchArchetype.Length > 0 ? matchArchetype : RosterArchetype(tournament, playerName);
    }

    /// <summary>The archetype the Tournament roster records for a player, or empty when it records none.</summary>
    public static string RosterArchetype(TournamentDocument tournament, string playerName)
    {
        var name = LeagueNormalizer.TrimPlayerName(playerName);
        return tournament.PlayerArchetypes.FirstOrDefault(row => LeagueNormalizer.TrimPlayerName(row.PlayerName) == name)?.Archetype.Trim() ?? string.Empty;
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

    private sealed class StatisticsAccumulator(string playerName)
    {
        public string PlayerName { get; } = playerName;
        public int PlayedMatchCount { get; set; }
        public int ByeCount { get; set; }
        public int MatchWins { get; set; }
        public int MatchLosses { get; set; }
        public int MatchDraws { get; set; }
        public int GameWins { get; set; }
        public int GameLosses { get; set; }
        public List<PlayerMatch> Matches { get; } = [];
        public Dictionary<string, MutableOpponentRecord> Opponents { get; } = new(StringComparer.Ordinal);
        public Dictionary<string, int> Archetypes { get; } = new(StringComparer.Ordinal);
    }

    private sealed class MutableOpponentRecord(string name)
    {
        public string Name { get; } = name;
        public int Wins { get; set; }
        public int Losses { get; set; }
        public int MatchCount { get; set; }
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
