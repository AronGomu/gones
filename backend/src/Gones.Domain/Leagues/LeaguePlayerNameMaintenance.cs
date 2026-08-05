namespace Gones.Domain.Leagues;

/// <summary>
/// Settings-level Player Name maintenance over the shared League source.
/// Source matching is exact and case-sensitive: only slots whose trimmed name
/// equals the source name ordinally are affected. Targets may merge into an
/// existing player (case-insensitive) exactly like regular renames.
/// </summary>
public static class LeaguePlayerNameMaintenance
{
    /// <summary>All trimmed, non-empty player name slots of a League, one item per occurrence, exact case preserved.</summary>
    public static IEnumerable<string> EnumeratePlayerNameSlots(LeagueDocument league)
    {
        foreach (var tournament in league.Tournaments)
        {
            foreach (var round in tournament.Rounds)
            {
                foreach (var entry in round.Entries)
                {
                    switch (entry)
                    {
                        case MatchRoundEntry match:
                            if (Slot(match.Player1Name) is { } player1) yield return player1;
                            if (Slot(match.Player2Name) is { } player2) yield return player2;
                            break;
                        case ByeRoundEntry bye:
                            if (Slot(bye.PlayerName) is { } byeName) yield return byeName;
                            break;
                        case InvalidRoundEntry invalid:
                            if (Slot(invalid.Player) is { } player) yield return player;
                            if (Slot(invalid.Opponent) is { } opponent) yield return opponent;
                            break;
                    }
                }
            }
        }
    }

    public static int CountExactOccurrences(LeagueDocument league, string name)
    {
        var source = RequiredName(name, nameof(name));
        return EnumeratePlayerNameSlots(league).Count(slot => string.Equals(slot, source, StringComparison.Ordinal));
    }

    public static LeagueDocument RenamePlayerExact(LeagueDocument league, string fromName, string toName)
    {
        var from = RequiredName(fromName, nameof(fromName));
        var to = RequiredName(toName, nameof(toName));
        if (string.Equals(from, to, StringComparison.Ordinal)) return league;
        return league with
        {
            Tournaments = league.Tournaments.Select(tournament => tournament with
            {
                Rounds = tournament.Rounds
                    .Select(round => round with { Entries = round.Entries.Select(entry => RenameEntryExact(entry, from, to)).ToArray() })
                    .ToArray(),
                PlayerArchetypes = RenameArchetypeRowsExact(tournament.PlayerArchetypes, from, to)
            }).ToArray()
        };
    }

    private static RoundEntry RenameEntryExact(RoundEntry entry, string from, string to) => entry switch
    {
        MatchRoundEntry match => match with
        {
            Player1Name = Rename(match.Player1Name, from, to),
            Player2Name = Rename(match.Player2Name, from, to)
        },
        ByeRoundEntry bye => bye with { PlayerName = Rename(bye.PlayerName, from, to) },
        InvalidRoundEntry invalid => invalid with
        {
            Player = Rename(invalid.Player, from, to),
            Opponent = Rename(invalid.Opponent, from, to)
        },
        _ => entry
    };

    private static IReadOnlyList<PlayerArchetypeDocument> RenameArchetypeRowsExact(IReadOnlyList<PlayerArchetypeDocument> rows, string from, string to)
    {
        var displayByKey = new Dictionary<string, string>(StringComparer.Ordinal);
        var archetypeByKey = new Dictionary<string, string>(StringComparer.Ordinal);
        var toKey = LeagueNormalizer.PlayerNameKey(to);
        foreach (var row in rows)
        {
            var original = LeagueNormalizer.TrimPlayerName(row.PlayerName);
            if (original.Length == 0) continue;
            var name = string.Equals(original, from, StringComparison.Ordinal) ? to : original;
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

    private static string Rename(string value, string from, string to) =>
        string.Equals(LeagueNormalizer.TrimPlayerName(value), from, StringComparison.Ordinal) ? to : value;

    private static string? Slot(string value)
    {
        var trimmed = LeagueNormalizer.TrimPlayerName(value);
        return trimmed.Length == 0 ? null : trimmed;
    }

    private static string RequiredName(string value, string parameter)
    {
        var trimmed = LeagueNormalizer.TrimPlayerName(value);
        if (trimmed.Length == 0) throw new ArgumentException("Player Name is required.", parameter);
        return trimmed;
    }
}
