using Gones.Domain.Archive;
using NodaTime;

namespace Gones.UnitTests;

/// <summary>
/// The archive lock window: a Tournament locks more than 365 whole calendar days after the day it was
/// played. Derived and never stored, and mirrored by the browser's <c>isArchiveTournamentLocked</c>, so
/// the two stacks must agree day for day.
/// </summary>
public sealed class ArchiveLockRuleTests
{
    [Fact]
    public void The_day_it_was_played_is_not_locked()
    {
        Assert.False(ArchiveLockRule.IsLocked(new LocalDate(2026, 8, 22), new LocalDate(2026, 8, 22)));
    }

    [Fact]
    public void Exactly_365_days_old_is_not_locked()
    {
        Assert.False(ArchiveLockRule.IsLocked(new LocalDate(2025, 8, 22), new LocalDate(2026, 8, 22)));
    }

    [Fact]
    public void Three_hundred_and_sixty_six_days_old_is_locked()
    {
        Assert.True(ArchiveLockRule.IsLocked(new LocalDate(2025, 8, 21), new LocalDate(2026, 8, 22)));
    }

    [Fact]
    public void Counts_whole_calendar_days_across_a_leap_day()
    {
        // 2028-02-29 is day 365 after 2027-03-01; 2028-03-01 is day 366.
        Assert.False(ArchiveLockRule.IsLocked(new LocalDate(2027, 3, 1), new LocalDate(2028, 2, 29)));
        Assert.True(ArchiveLockRule.IsLocked(new LocalDate(2027, 3, 1), new LocalDate(2028, 3, 1)));
    }

    [Fact]
    public void A_future_date_is_never_locked()
    {
        Assert.False(ArchiveLockRule.IsLocked(new LocalDate(2027, 1, 1), new LocalDate(2026, 8, 22)));
    }

    [Fact]
    public void The_lock_window_is_three_hundred_and_sixty_five_days()
    {
        Assert.Equal(365, ArchiveLockRule.LockWindowDays);
    }
}
