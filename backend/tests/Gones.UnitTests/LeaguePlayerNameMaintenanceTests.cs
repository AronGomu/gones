using Gones.Domain.Leagues;

namespace Gones.UnitTests;

public sealed class LeaguePlayerNameMaintenanceTests
{
    private static LeagueDocument League(params RoundEntry[] entries) => new(
        "league-1",
        "League",
        "active",
        [
            new TournamentDocument(
                "tournament-1",
                "league-1",
                "T1",
                "2026-08-01",
                [new RoundDocument("round-1", entries)],
                [new PlayerArchetypeDocument("Alice", "Burn (Red)"), new PlayerArchetypeDocument("alice", "Elves (Green)")])
        ]);

    private static MatchRoundEntry Match(string player1, string player2) =>
        new("entry-1", "1", player1, player2, 2, 1, string.Empty, string.Empty);

    [Fact]
    public void Occurrence_count_is_exact_case_sensitive()
    {
        var league = League(Match("Alice", "alice"), new ByeRoundEntry("entry-2", "2", "Alice", string.Empty));
        Assert.Equal(2, LeaguePlayerNameMaintenance.CountExactOccurrences(league, "Alice"));
        Assert.Equal(1, LeaguePlayerNameMaintenance.CountExactOccurrences(league, "alice"));
        Assert.Equal(0, LeaguePlayerNameMaintenance.CountExactOccurrences(league, "ALICE"));
    }

    [Fact]
    public void Rename_touches_only_exact_case_matches()
    {
        var league = League(Match("Alice", "alice"));
        var renamed = LeaguePlayerNameMaintenance.RenamePlayerExact(league, "Alice", "Alicia");
        var entry = Assert.IsType<MatchRoundEntry>(renamed.Tournaments[0].Rounds[0].Entries[0]);
        Assert.Equal("Alicia", entry.Player1Name);
        Assert.Equal("alice", entry.Player2Name);
    }

    [Fact]
    public void Rename_merges_archetype_rows_into_target()
    {
        var league = League(Match("Alice", "Bob"));
        var renamed = LeaguePlayerNameMaintenance.RenamePlayerExact(league, "Alice", "alice");
        var rows = renamed.Tournaments[0].PlayerArchetypes;
        var row = Assert.Single(rows);
        Assert.Equal("alice", row.PlayerName);
        Assert.Equal("Burn (Red)", row.Archetype);
    }

    [Fact]
    public void Rename_requires_names()
    {
        var league = League(Match("Alice", "Bob"));
        Assert.ThrowsAny<ArgumentException>(() => LeaguePlayerNameMaintenance.RenamePlayerExact(league, " ", "Alicia"));
        Assert.ThrowsAny<ArgumentException>(() => LeaguePlayerNameMaintenance.RenamePlayerExact(league, "Alice", " "));
    }

    [Fact]
    public void Enumerates_all_entry_slots_including_invalid_rows()
    {
        var league = League(
            Match("Alice", "Bob"),
            new ByeRoundEntry("entry-2", "2", "Cara", string.Empty),
            new InvalidRoundEntry("entry-3", "raw", "3", "Dan", "2-0", "Eve", string.Empty, string.Empty));
        var slots = LeaguePlayerNameMaintenance.EnumeratePlayerNameSlots(league).ToArray();
        Assert.Equal(["Alice", "Bob", "Cara", "Dan", "Eve"], slots);
    }
}
