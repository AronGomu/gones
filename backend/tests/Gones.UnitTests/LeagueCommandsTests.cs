using Gones.Domain.Leagues;

namespace Gones.UnitTests;

/// <summary>
/// The Archive Tournament completion flag as the commands move it: a new Tournament starts
/// <c>active</c>, editing can complete or reopen it, and a Restore carries each Tournament's own
/// status across unchanged.
/// </summary>
public sealed class LeagueCommandsTests
{
    private static readonly LeagueDocument Empty = new("league-1", "League", "active", []);

    [Fact]
    public void Creates_a_tournament_active()
    {
        var league = LeagueCommands.AddTournament(Empty, "tournament-1", "T1", "2026-08-16");
        Assert.Equal("active", Assert.Single(league.Tournaments).Status);
    }

    [Fact]
    public void Completes_a_tournament()
    {
        var league = LeagueCommands.AddTournament(Empty, "tournament-1", "T1", "2026-08-16");
        var completed = LeagueCommands.EditTournament(league, "tournament-1", "T1", "2026-08-16", "completed");
        Assert.Equal("completed", Assert.Single(completed.Tournaments).Status);
    }

    [Fact]
    public void Reopens_a_tournament()
    {
        var league = LeagueCommands.AddTournament(Empty, "tournament-1", "T1", "2026-08-16");
        var completed = LeagueCommands.EditTournament(league, "tournament-1", "T1", "2026-08-16", "completed");
        var reopened = LeagueCommands.EditTournament(completed, "tournament-1", "T1", "2026-08-16", "active");
        Assert.Equal("active", Assert.Single(reopened.Tournaments).Status);
    }

    [Fact]
    public void Keeps_the_status_when_an_edit_omits_it()
    {
        var league = LeagueCommands.AddTournament(Empty, "tournament-1", "T1", "2026-08-16");
        var completed = LeagueCommands.EditTournament(league, "tournament-1", "T1", "2026-08-16", "completed");
        var renamed = LeagueCommands.EditTournament(completed, "tournament-1", "Renamed", "2026-08-16");
        Assert.Equal("completed", Assert.Single(renamed.Tournaments).Status);
    }

    [Fact]
    public void Rejects_an_unknown_status()
    {
        var league = LeagueCommands.AddTournament(Empty, "tournament-1", "T1", "2026-08-16");
        Assert.Throws<ArgumentException>(() => LeagueCommands.EditTournament(league, "tournament-1", "T1", "2026-08-16", "weird"));
    }

    [Fact]
    public void Applies_the_status_through_an_edit_batch()
    {
        var league = LeagueCommands.AddTournament(Empty, "tournament-1", "T1", "2026-08-16");
        var batch = new ArchiveTournamentEditBatch(new EditArchiveTournamentIntent("T1", "2026-08-16", "completed"), [], [], [], []);
        var applied = LeagueCommands.ApplyTournamentEditBatch(league, "tournament-1", batch);
        Assert.Equal("completed", Assert.Single(applied.Tournaments).Status);
    }

    [Fact]
    public void Restore_preserves_status()
    {
        var mixed = new LeagueDocument("league-1", "League", "active",
        [
            new TournamentDocument("t1", "league-1", "Completed One", "2026-01-01", "completed", [], []),
            new TournamentDocument("t2", "league-1", "Active One", "2026-02-01", "active", [], [])
        ]);
        var idFactory = NewIdFactory();

        var restored = LeagueCommands.Restore(mixed, "league-2", "League (restored)", idFactory);

        Assert.Equal(["completed", "active"], restored.Tournaments.Select(tournament => tournament.Status));
        Assert.Equal(["Completed One", "Active One"], restored.Tournaments.Select(tournament => tournament.Name));
    }

    private static Func<string> NewIdFactory()
    {
        var next = 0;
        return () => $"restored-{++next}";
    }
}
