using NodaTime;

namespace Gones.Domain.Archive;

/// <summary>
/// A Tournament locks 365 days after the day it was played. Derived, never stored: a row cached today
/// as unlocked would otherwise become locked without a refetch. The browser mirrors this rule in
/// <c>isArchiveTournamentLocked</c>, so the two must agree day for day.
/// </summary>
public static class ArchiveLockRule
{
    public const int LockWindowDays = 365;

    /// <summary>
    /// <c>locked ⇔ (today - tournamentDate) &gt; 365</c>, counted in whole calendar days. Exactly 365
    /// days old is not locked; 366 days old is. A future date is never locked.
    /// </summary>
    public static bool IsLocked(LocalDate tournamentDate, LocalDate today) =>
        Period.Between(tournamentDate, today, PeriodUnits.Days).Days > LockWindowDays;
}
