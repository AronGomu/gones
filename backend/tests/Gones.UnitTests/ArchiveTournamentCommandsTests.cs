using Gones.Domain.Archive;
using Gones.Domain.Leagues;
using NodaTime;

namespace Gones.UnitTests;

/// <summary>
/// The Tournament-tier command functions. They own no mutation rules of their own: every round, entry
/// and archetype transform is delegated to <see cref="LeagueCommands"/> through a synthetic carrier
/// League, so the two tiers cannot normalize a player name or merge an archetype differently.
/// </summary>
public sealed class ArchiveTournamentCommandsTests
{
    [Fact]
    public void Creates_a_standalone_tournament_active_with_a_trimmed_name()
    {
        var tournament = ArchiveTournamentCommands.Create("t1", null, "  Open  ", "2026-08-17");

        Assert.Equal("t1", tournament.Id);
        Assert.Null(tournament.SeasonId);
        Assert.Equal("Open", tournament.Name);
        Assert.Equal("2026-08-17", tournament.TournamentDate);
        Assert.Equal("active", tournament.Status);
        Assert.Empty(tournament.Rounds);
        Assert.Empty(tournament.PlayerArchetypes);
    }

    [Fact]
    public void Creates_an_attached_tournament_carrying_its_season_id()
    {
        Assert.Equal("season-1", ArchiveTournamentCommands.Create("t1", "season-1", "Open", "2026-08-17").SeasonId);
    }

    [Fact]
    public void Creates_refuses_an_unparsable_date()
    {
        var exception = Assert.Throws<ArgumentException>(() => ArchiveTournamentCommands.Create("t1", null, "Open", "17/08/2026"));

        Assert.Equal("tournamentDate", exception.ParamName);
    }

    [Fact]
    public void Moves_a_tournament_between_seasons_and_to_standalone()
    {
        var tournament = WithOneRound();

        var moved = ArchiveTournamentCommands.MoveToSeason(tournament, "season-2");
        var detached = ArchiveTournamentCommands.MoveToSeason(moved, null);

        Assert.Equal("season-2", moved.SeasonId);
        Assert.Null(detached.SeasonId);
        // A move carries no content: the Rounds and archetypes travel unchanged.
        Assert.Equal(tournament.Rounds, detached.Rounds);
        Assert.Equal(tournament.PlayerArchetypes, detached.PlayerArchetypes);
    }

    [Fact]
    public void Adds_and_deletes_a_round()
    {
        var added = ArchiveTournamentCommands.AddRound(Empty(), "round-1");

        Assert.Equal(["round-1"], added.Rounds.Select(round => round.Id));
        Assert.Empty(ArchiveTournamentCommands.DeleteRound(added, "round-1").Rounds);
    }

    [Fact]
    public void Refuses_a_duplicate_round_id()
    {
        var added = ArchiveTournamentCommands.AddRound(Empty(), "round-1");

        Assert.Throws<InvalidOperationException>(() => ArchiveTournamentCommands.AddRound(added, "round-1"));
    }

    [Fact]
    public void Refuses_an_unknown_round_id()
    {
        Assert.Throws<KeyNotFoundException>(() => ArchiveTournamentCommands.DeleteRound(WithOneRound(), "missing"));
    }

    [Fact]
    public void Normalizes_an_added_entry_through_the_shared_rules()
    {
        var added = ArchiveTournamentCommands.AddEntry(WithOneRound(), "round-1", new ByeRoundEntry("e1", "2", "  Carol  ", "  Earth  "));

        var bye = Assert.IsType<ByeRoundEntry>(added.Rounds.Single().Entries.Last());
        Assert.Equal("Carol", bye.PlayerName);
        Assert.Equal("Earth", bye.DeckArchetype);
    }

    [Fact]
    public void Merges_imported_archetypes_into_the_tournament()
    {
        RoundEntry[] imported =
        [
            new MatchRoundEntry("i1", "1", "Carol", "Dan", 2, 0, "Aggro", "Control"),
            new ByeRoundEntry("i2", "2", "Bob", "Midrange")
        ];

        var replaced = ArchiveTournamentCommands.ReplaceRound(WithOneRound(), "round-1", imported, mergeImportedArchetypes: true);

        Assert.Equal(["Bob", "Carol", "Dan"], replaced.PlayerArchetypes.Select(item => item.PlayerName));
        Assert.Equal(["Midrange", "Aggro", "Control"], replaced.PlayerArchetypes.Select(item => item.Archetype));
    }

    [Fact]
    public void Updates_one_archetype_and_keeps_the_sort()
    {
        var updated = ArchiveTournamentCommands.UpdateArchetype(
            ArchiveTournamentCommands.UpdateArchetype(WithOneRound(), "Carol", "Aggro"),
            "Bob",
            "Midrange");

        Assert.Equal(["Bob", "Carol"], updated.PlayerArchetypes.Select(item => item.PlayerName));
        Assert.Equal("Midrange", updated.PlayerArchetypes.Single(item => item.PlayerName == "Bob").Archetype);
    }

    [Fact]
    public void Renames_a_player_inside_the_tournament()
    {
        var renamed = ArchiveTournamentCommands.RenamePlayer(WithOneRound(), "Alice", "Alicia");

        var match = Assert.IsType<MatchRoundEntry>(renamed.Rounds.Single().Entries.Single());
        Assert.Equal("Alicia", match.Player1Name);
        Assert.Equal("Bob", match.Player2Name);
    }

    [Fact]
    public void Applies_every_edit_batch_intent_in_order()
    {
        var addedRoundId = Guid.NewGuid().ToString("D");
        var tournament = ArchiveTournamentCommands.AddRound(WithOneRound(), "round-2");
        var batch = new ArchiveTournamentEditBatch(
            new EditArchiveTournamentIntent("Renamed", "2026-09-01"),
            [new AddArchiveRoundIntent(addedRoundId, [new ByeRoundEntry("ignored", "1", "Dan", "Control")])],
            ["round-1"],
            [new ReplaceArchiveRoundIntent("round-2", [new ByeRoundEntry("r2e1", "1", "Carol", "Aggro")])],
            [new UpdateArchiveArchetypeIntent("Bob", "Midrange")],
            "completed");

        var applied = ArchiveTournamentCommands.ApplyEditBatch(tournament, batch);

        Assert.Equal("Renamed", applied.Name);
        Assert.Equal("2026-09-01", applied.TournamentDate);
        Assert.Equal("completed", applied.Status);
        // delete -> add(+replace) -> replace -> archetypes -> status: round-1 is gone and the added
        // Round sits after the surviving one.
        Assert.Equal(["round-2", addedRoundId], applied.Rounds.Select(round => round.Id));
        Assert.Equal("Carol", Assert.IsType<ByeRoundEntry>(applied.Rounds[0].Entries.Single()).PlayerName);
        Assert.Equal("Dan", Assert.IsType<ByeRoundEntry>(applied.Rounds[1].Entries.Single()).PlayerName);
        Assert.Equal("Midrange", applied.PlayerArchetypes.Single(item => item.PlayerName == "Bob").Archetype);
    }

    [Fact]
    public void Refuses_a_round_deleted_and_replaced_in_one_batch()
    {
        var batch = new ArchiveTournamentEditBatch(
            null,
            [],
            ["round-1"],
            [new ReplaceArchiveRoundIntent("round-1", [])],
            [],
            null);

        var exception = Assert.Throws<ArgumentException>(() => ArchiveTournamentCommands.ApplyEditBatch(WithOneRound(), batch));

        Assert.Equal("replaceRounds", exception.ParamName);
    }

    [Fact]
    public void Restores_a_bundle_with_fresh_round_and_entry_ids()
    {
        var source = WithOneRound();

        var restored = Assert.Single(ArchiveTournamentCommands.Restore([source], () => Guid.NewGuid().ToString("D")));

        Assert.NotEqual(source.Id, restored.Id);
        Assert.NotEqual(source.Rounds.Single().Id, restored.Rounds.Single().Id);
        Assert.NotEqual(source.Rounds.Single().Entries.Single().Id, restored.Rounds.Single().Entries.Single().Id);
        Assert.All(
            new[] { restored.Id, restored.Rounds.Single().Id, restored.Rounds.Single().Entries.Single().Id },
            id => Assert.True(Guid.TryParseExact(id, "D", out _), id));
        Assert.Equal(source.Name, restored.Name);
        Assert.Equal(source.TournamentDate, restored.TournamentDate);
        Assert.Equal(source.Status, restored.Status);
        Assert.Equal(source.SeasonId, restored.SeasonId);
    }

    [Fact]
    public void Restores_an_empty_bundle_as_an_empty_list()
    {
        Assert.Empty(ArchiveTournamentCommands.Restore([], () => Guid.NewGuid().ToString("D")));
    }

    [Fact]
    public void Parses_and_formats_an_iso_date()
    {
        Assert.Equal(new LocalDate(2026, 8, 17), ArchiveTournamentCommands.ParseDate("2026-08-17"));
        Assert.Equal("2026-08-17", ArchiveTournamentCommands.FormatDate(new LocalDate(2026, 8, 17)));
        Assert.Equal("tournamentDate", Assert.Throws<ArgumentException>(() => ArchiveTournamentCommands.ParseDate("17/08/2026")).ParamName);
    }

    private static ArchiveTournamentDocument Empty() =>
        new("t1", "Open", "season-1", "2026-08-17", "active", [], []);

    private static ArchiveTournamentDocument WithOneRound() => Empty() with
    {
        Rounds = [new RoundDocument("round-1", [new MatchRoundEntry("entry-1", "1", "Alice", "Bob", 2, 1, "Tempo", "Control")])]
    };
}
