namespace Gones.Domain.Leagues;

public static class LeagueCommands
{
    public static LeagueDocument RenameLeague(LeagueDocument league, string name)
    {
        RequireLeagueName(name, nameof(name));
        if (league.Id == LeagueNormalizer.PlaceholderLeagueId) throw new InvalidOperationException("Placeholder League cannot be renamed.");
        return league with { Name = name.Trim() };
    }

    public static LeagueDocument ChangeStatus(LeagueDocument league, string status)
    {
        if (status is not ("active" or "completed")) throw new ArgumentException("League status must be active or completed.", nameof(status));
        return league with { Status = status };
    }

    public static LeagueDocument AddTournament(LeagueDocument league, string tournamentId, string name, string tournamentDate)
    {
        RequireActive(league);
        RequireNewId(league.Tournaments.Select(item => item.Id), tournamentId, nameof(tournamentId));
        RequireMutableName(name, nameof(name));
        var tournament = new TournamentDocument(tournamentId, league.Id, name.Trim(), tournamentDate?.Trim() ?? string.Empty, [], []);
        return league with { Tournaments = [.. league.Tournaments, tournament] };
    }

    public static LeagueDocument EditTournament(LeagueDocument league, string tournamentId, string name, string tournamentDate)
    {
        RequireActive(league);
        RequireMutableName(name, nameof(name));
        return ReplaceTournament(league, tournamentId, tournament => tournament with
        {
            Name = name.Trim(),
            TournamentDate = tournamentDate?.Trim() ?? string.Empty
        });
    }

    public static LeagueDocument DeleteTournament(LeagueDocument league, string tournamentId)
    {
        RequireActive(league);
        RequireTournament(league, tournamentId);
        return league with { Tournaments = league.Tournaments.Where(item => item.Id != tournamentId).ToArray() };
    }

    public static (LeagueDocument Source, LeagueDocument Target) MoveTournament(
        LeagueDocument source,
        LeagueDocument target,
        string tournamentId)
    {
        RequireActive(source);
        RequireActive(target);
        if (source.Id == target.Id) return (source, target);
        var tournament = RequireTournament(source, tournamentId);
        if (target.Tournaments.Any(item => item.Id == tournamentId)) throw new InvalidOperationException("Target League already contains Tournament ID.");
        return (
            source with { Tournaments = source.Tournaments.Where(item => item.Id != tournamentId).ToArray() },
            target with { Tournaments = [.. target.Tournaments, tournament with { LeagueId = target.Id }] });
    }

    public static LeagueDocument AddRound(LeagueDocument league, string tournamentId, string roundId)
    {
        RequireActive(league);
        return ReplaceTournament(league, tournamentId, tournament =>
        {
            RequireNewId(tournament.Rounds.Select(item => item.Id), roundId, nameof(roundId));
            return tournament with { Rounds = [.. tournament.Rounds, new RoundDocument(roundId, [])] };
        });
    }

    public static LeagueDocument DeleteRound(LeagueDocument league, string tournamentId, string roundId)
    {
        RequireActive(league);
        return ReplaceTournament(league, tournamentId, tournament =>
        {
            RequireRound(tournament, roundId);
            return tournament with { Rounds = tournament.Rounds.Where(item => item.Id != roundId).ToArray() };
        });
    }

    public static LeagueDocument ReplaceRound(
        LeagueDocument league,
        string tournamentId,
        string roundId,
        IReadOnlyList<RoundEntry> entries,
        bool mergeImportedArchetypes)
    {
        RequireActive(league);
        return ReplaceTournament(league, tournamentId, tournament =>
        {
            RequireRound(tournament, roundId);
            var normalizedEntries = entries.Select(NormalizeEntry).ToArray();
            var archetypes = mergeImportedArchetypes
                ? MergeImportedArchetypes(tournament.PlayerArchetypes, normalizedEntries, out normalizedEntries)
                : tournament.PlayerArchetypes;
            return tournament with
            {
                Rounds = tournament.Rounds.Select(round => round.Id == roundId ? round with { Entries = normalizedEntries } : round).ToArray(),
                PlayerArchetypes = archetypes
            };
        });
    }

    public static LeagueDocument AddEntry(LeagueDocument league, string tournamentId, string roundId, RoundEntry entry)
    {
        RequireActive(league);
        return ReplaceRoundEntryCollection(league, tournamentId, roundId, entries =>
        {
            var normalized = NormalizeEntry(entry);
            RequireNewId(entries.Select(item => item.Id), normalized.Id, "entry.id");
            return [.. entries, normalized];
        });
    }

    public static LeagueDocument EditEntry(LeagueDocument league, string tournamentId, string roundId, string entryId, RoundEntry entry)
    {
        RequireActive(league);
        return ReplaceRoundEntryCollection(league, tournamentId, roundId, entries =>
        {
            if (!entries.Any(item => item.Id == entryId)) throw new KeyNotFoundException("Round Entry not found.");
            if (entry.Id != entryId) throw new ArgumentException("Round Entry ID cannot change.", nameof(entry));
            var normalized = NormalizeEntry(entry);
            return entries.Select(item => item.Id == entryId ? normalized : item).ToArray();
        });
    }

    public static LeagueDocument DeleteEntry(LeagueDocument league, string tournamentId, string roundId, string entryId)
    {
        RequireActive(league);
        return ReplaceRoundEntryCollection(league, tournamentId, roundId, entries =>
        {
            if (!entries.Any(item => item.Id == entryId)) throw new KeyNotFoundException("Round Entry not found.");
            return entries.Where(item => item.Id != entryId).ToArray();
        });
    }

    public static LeagueDocument UpdateArchetype(LeagueDocument league, string tournamentId, string playerName, string archetype)
    {
        RequireActive(league);
        var name = LeagueNormalizer.TrimPlayerName(playerName);
        if (name.Length == 0) throw new ArgumentException("Player Name is required.", nameof(playerName));
        return ReplaceTournament(league, tournamentId, tournament =>
        {
            var rows = tournament.PlayerArchetypes
                .Where(item => LeagueNormalizer.TrimPlayerName(item.PlayerName).Length > 0)
                .ToDictionary(item => LeagueNormalizer.TrimPlayerName(item.PlayerName), item => LeagueNormalizer.NormalizeDeckArchetype(item.Archetype), StringComparer.Ordinal);
            rows[name] = LeagueNormalizer.NormalizeDeckArchetype(archetype);
            var ordered = rows.Select(item => new PlayerArchetypeDocument(item.Key, item.Value)).ToList();
            ordered.Sort((left, right) => LeagueNormalizer.ComparePlayerNames(left.PlayerName, right.PlayerName));
            return tournament with { PlayerArchetypes = ordered };
        });
    }

    public static LeagueDocument RenamePlayer(LeagueDocument league, string fromName, string toName)
    {
        RequireActive(league);
        var from = LeagueNormalizer.TrimPlayerName(fromName);
        var to = LeagueNormalizer.TrimPlayerName(toName);
        if (from.Length == 0) throw new ArgumentException("Source Player Name is required.", nameof(fromName));
        if (to.Length == 0) throw new ArgumentException("Target Player Name is required.", nameof(toName));
        return LeagueRules.RenamePlayer(league, from, to);
    }

    public static LeagueDocument Restore(LeagueDocument source, string newLeagueId, string newName, Func<string> idFactory)
    {
        RequireNewId([], newLeagueId, nameof(newLeagueId));
        RequireLeagueName(newName, nameof(newName));
        return new LeagueDocument(
            newLeagueId,
            newName,
            source.Status,
            source.Tournaments.Select(tournament => new TournamentDocument(
                idFactory(),
                newLeagueId,
                tournament.Name,
                tournament.TournamentDate,
                tournament.Rounds.Select(round => new RoundDocument(
                    idFactory(),
                    round.Entries.Select(entry => RemapEntry(entry, idFactory())).ToArray())).ToArray(),
                tournament.PlayerArchetypes.Select(item => item with { }).ToArray())).ToArray());
    }

    private static LeagueDocument ReplaceRoundEntryCollection(
        LeagueDocument league,
        string tournamentId,
        string roundId,
        Func<IReadOnlyList<RoundEntry>, IReadOnlyList<RoundEntry>> replace) =>
        ReplaceTournament(league, tournamentId, tournament =>
        {
            RequireRound(tournament, roundId);
            return tournament with
            {
                Rounds = tournament.Rounds.Select(round => round.Id == roundId ? round with { Entries = replace(round.Entries) } : round).ToArray()
            };
        });

    private static LeagueDocument ReplaceTournament(LeagueDocument league, string tournamentId, Func<TournamentDocument, TournamentDocument> replace)
    {
        var tournament = RequireTournament(league, tournamentId);
        return league with { Tournaments = league.Tournaments.Select(item => item.Id == tournamentId ? replace(tournament) : item).ToArray() };
    }

    private static TournamentDocument RequireTournament(LeagueDocument league, string tournamentId) =>
        league.Tournaments.SingleOrDefault(item => item.Id == tournamentId)
        ?? throw new KeyNotFoundException("Tournament not found.");

    private static RoundDocument RequireRound(TournamentDocument tournament, string roundId) =>
        tournament.Rounds.SingleOrDefault(item => item.Id == roundId)
        ?? throw new KeyNotFoundException("Round not found.");

    private static void RequireActive(LeagueDocument league)
    {
        if (league.Status != "active") throw new InvalidOperationException("Completed League must be reopened before source data can change.");
    }

    private static void RequireMutableName(string? name, string field)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new ArgumentException("Name is required.", field);
        if (name.Trim().Length > LeagueAggregate.MaximumNameLength) throw new ArgumentException($"Name cannot exceed {LeagueAggregate.MaximumNameLength} characters.", field);
    }

    private static void RequireLeagueName(string? name, string field)
    {
        RequireMutableName(name, field);
        if (LeagueNormalizer.IsUnassignedLeagueName(name)) throw new ArgumentException("Reserved placeholder League name cannot be used.", field);
    }

    private static void RequireNewId(IEnumerable<string> existing, string? id, string field)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > LeagueAggregate.MaximumDocumentIdLength) throw new ArgumentException("ID is invalid.", field);
        if (existing.Contains(id, StringComparer.Ordinal)) throw new InvalidOperationException("ID already exists.");
    }

    private static RoundEntry NormalizeEntry(RoundEntry entry) => entry switch
    {
        MatchRoundEntry match => match with
        {
            Table = match.Table ?? string.Empty,
            Player1Name = LeagueNormalizer.TrimPlayerName(match.Player1Name),
            Player2Name = LeagueNormalizer.TrimPlayerName(match.Player2Name),
            Player1Score = Math.Max(0, match.Player1Score),
            Player2Score = Math.Max(0, match.Player2Score),
            Player1DeckArchetype = LeagueNormalizer.NormalizeDeckArchetype(match.Player1DeckArchetype),
            Player2DeckArchetype = LeagueNormalizer.NormalizeDeckArchetype(match.Player2DeckArchetype)
        },
        ByeRoundEntry bye => bye with
        {
            Table = bye.Table ?? string.Empty,
            PlayerName = LeagueNormalizer.TrimPlayerName(bye.PlayerName),
            DeckArchetype = LeagueNormalizer.NormalizeDeckArchetype(bye.DeckArchetype)
        },
        InvalidRoundEntry invalid => invalid with
        {
            RawText = invalid.RawText ?? string.Empty,
            Table = invalid.Table ?? string.Empty,
            Player = LeagueNormalizer.TrimPlayerName(invalid.Player),
            Result = invalid.Result ?? string.Empty,
            Opponent = LeagueNormalizer.TrimPlayerName(invalid.Opponent),
            PlayerDecklist = invalid.PlayerDecklist ?? string.Empty,
            OpponentDecklist = invalid.OpponentDecklist ?? string.Empty
        },
        _ => throw new ArgumentException("Round Entry kind is invalid.", nameof(entry))
    };

    private static IReadOnlyList<PlayerArchetypeDocument> MergeImportedArchetypes(
        IReadOnlyList<PlayerArchetypeDocument> stored,
        IReadOnlyList<RoundEntry> imported,
        out RoundEntry[] normalizedEntries)
    {
        var map = stored
            .Where(item => LeagueNormalizer.TrimPlayerName(item.PlayerName).Length > 0)
            .ToDictionary(item => LeagueNormalizer.TrimPlayerName(item.PlayerName), item => LeagueNormalizer.NormalizeDeckArchetype(item.Archetype), StringComparer.Ordinal);
        normalizedEntries = imported.Select(entry => entry switch
        {
            MatchRoundEntry match => match with
            {
                Player1DeckArchetype = Resolve(match.Player1Name, match.Player1DeckArchetype),
                Player2DeckArchetype = Resolve(match.Player2Name, match.Player2DeckArchetype)
            },
            ByeRoundEntry bye => bye with { DeckArchetype = Resolve(bye.PlayerName, bye.DeckArchetype) },
            _ => entry
        }).ToArray();
        var rows = map.Select(item => new PlayerArchetypeDocument(item.Key, item.Value)).ToList();
        rows.Sort((left, right) => LeagueNormalizer.ComparePlayerNames(left.PlayerName, right.PlayerName));
        return rows;

        string Resolve(string playerName, string archetype)
        {
            var name = LeagueNormalizer.TrimPlayerName(playerName);
            var normalized = LeagueNormalizer.NormalizeDeckArchetype(archetype);
            if (name.Length == 0) return normalized;
            if (map.TryGetValue(name, out var existing)) return existing;
            map.Add(name, normalized);
            return normalized;
        }
    }

    private static RoundEntry RemapEntry(RoundEntry entry, string newId) => entry switch
    {
        MatchRoundEntry match => match with { Id = newId },
        ByeRoundEntry bye => bye with { Id = newId },
        InvalidRoundEntry invalid => invalid with { Id = newId },
        _ => throw new ArgumentException("Round Entry kind is invalid.", nameof(entry))
    };
}
