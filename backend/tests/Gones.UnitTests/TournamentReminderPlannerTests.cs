using Gones.Domain.Calendar;
using NodaTime;

namespace Gones.UnitTests;

public sealed class TournamentReminderPlannerTests
{
    [Fact]
    public void Monthly_anchors_use_event_day_and_truncate_short_months()
    {
        var occurrences = TournamentReminderPlanner.Plan(
            new LocalDate(2027, 5, 31),
            "Europe/Paris",
            Instant.FromUtc(2027, 1, 1, 0, 0));

        Assert.Contains(occurrences, item => item.Type == ScheduledNotificationType.Monthly && item.VenueDate == new LocalDate(2027, 1, 31));
        Assert.Contains(occurrences, item => item.Type == ScheduledNotificationType.Monthly && item.VenueDate == new LocalDate(2027, 2, 28));
        Assert.Contains(occurrences, item => item.Type == ScheduledNotificationType.Monthly && item.VenueDate == new LocalDate(2027, 3, 31));
        Assert.DoesNotContain(occurrences, item => item.Type == ScheduledNotificationType.Monthly && item.VenueDate >= new LocalDate(2027, 4, 30));
    }

    [Fact]
    public void Final_month_uses_saturdays_plus_day_two_and_day_one()
    {
        var occurrences = TournamentReminderPlanner.Plan(
            new LocalDate(2027, 8, 15),
            "Europe/Paris",
            Instant.FromUtc(2027, 7, 1, 0, 0));

        Assert.Equal(
            [new LocalDate(2027, 7, 17), new LocalDate(2027, 7, 24), new LocalDate(2027, 7, 31), new LocalDate(2027, 8, 7)],
            occurrences.Where(item => item.Type == ScheduledNotificationType.Saturday).Select(item => item.VenueDate).ToArray());
        Assert.Contains(occurrences, item => item.Type == ScheduledNotificationType.DayTwo && item.VenueDate == new LocalDate(2027, 8, 13));
        Assert.Contains(occurrences, item => item.Type == ScheduledNotificationType.DayOne && item.VenueDate == new LocalDate(2027, 8, 14));
    }

    [Fact]
    public void Overlapping_saturday_and_day_reminder_produces_one_urgent_occurrence()
    {
        var occurrences = TournamentReminderPlanner.Plan(
            new LocalDate(2027, 5, 31),
            "Europe/Paris",
            Instant.FromUtc(2027, 5, 1, 0, 0));

        var overlap = Assert.Single(occurrences, item => item.VenueDate == new LocalDate(2027, 5, 29));
        Assert.Equal(ScheduledNotificationType.DayTwo, overlap.Type);
    }

    [Fact]
    public void Planner_never_returns_past_or_current_instants()
    {
        var now = Instant.FromUtc(2027, 8, 7, 8, 0);
        var occurrences = TournamentReminderPlanner.Plan(new LocalDate(2027, 8, 15), "Europe/Paris", now);

        Assert.All(occurrences, item => Assert.True(item.ScheduledAtUtc > now));
        Assert.DoesNotContain(occurrences, item => item.VenueDate == new LocalDate(2027, 8, 7));
    }

    [Theory]
    [InlineData("Europe/Paris")]
    [InlineData("America/New_York")]
    [InlineData("Australia/Lord_Howe")]
    public void Every_reminder_is_exactly_ten_in_venue_zone_across_dst(string timeZoneId)
    {
        var zone = DateTimeZoneProviders.Tzdb[timeZoneId];
        var occurrences = TournamentReminderPlanner.Plan(
            new LocalDate(2027, 11, 15),
            timeZoneId,
            Instant.FromUtc(2027, 1, 1, 0, 0));

        Assert.NotEmpty(occurrences);
        Assert.All(occurrences, item => Assert.Equal(new LocalTime(10, 0), item.ScheduledAtUtc.InZone(zone).TimeOfDay));
    }

    [Fact]
    public void Spring_gap_and_autumn_overlap_offset_changes_do_not_shift_local_ten()
    {
        var zone = DateTimeZoneProviders.Tzdb["Europe/Paris"];
        var spring = TournamentReminderPlanner.Plan(new LocalDate(2027, 4, 30), zone.Id, Instant.FromUtc(2027, 2, 1, 0, 0));
        var autumn = TournamentReminderPlanner.Plan(new LocalDate(2027, 11, 30), zone.Id, Instant.FromUtc(2027, 9, 1, 0, 0));

        Assert.Contains(spring, item => item.ScheduledAtUtc.InZone(zone).Offset == Offset.FromHours(1));
        Assert.Contains(spring, item => item.ScheduledAtUtc.InZone(zone).Offset == Offset.FromHours(2));
        Assert.Contains(autumn, item => item.ScheduledAtUtc.InZone(zone).Offset == Offset.FromHours(2));
        Assert.Contains(autumn, item => item.ScheduledAtUtc.InZone(zone).Offset == Offset.FromHours(1));
        Assert.All(spring.Concat(autumn), item => Assert.Equal(new LocalTime(10, 0), item.ScheduledAtUtc.InZone(zone).TimeOfDay));
    }
}
