using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using NodaTime;

namespace Gones.UnitTests;

public sealed class ScheduledTournamentDomainTests
{
    private static readonly Instant Now = Instant.FromUtc(2026, 8, 1, 12, 0);
    private static readonly Guid OrganizationId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();

    [Fact]
    public void Create_requires_title_address_start_zone_and_legacy_format()
    {
        Assert.Throws<ArgumentException>(() => Create(Draft() with { Title = " " }));
        Assert.Throws<ArgumentException>(() => Create(Draft() with { StreetAddress = " " }));
        Assert.Throws<ArgumentException>(() => Create(Draft() with { City = " " }));
        Assert.Throws<ArgumentException>(() => Create(Draft() with { Country = " " }));
        Assert.Throws<ArgumentException>(() => Create(Draft() with { TimeZoneId = "Europe/Nope" }));
        Assert.Throws<ArgumentException>(() => ScheduledTournament.Create(OrganizationId, UserId, Draft(), [TournamentFormat.Create("Modern", "modern", 1, Now)], Now));
    }

    [Fact]
    public void Create_normalizes_slug_search_content_and_derives_missing_end_as_local_end_of_day()
    {
        var tournament = Create(Draft() with
        {
            Slug = "  Legacy-Cup ",
            Summary = "  Prizes ",
            BodyHtml = "<p>Hello <strong>Legacy</strong><br /></p>",
            StartsAtLocal = new LocalDateTime(2026, 3, 29, 10, 0),
            EndsAtLocal = null,
            TimeZoneId = "Europe/Paris"
        });

        Assert.Equal("legacy-cup", tournament.Slug);
        Assert.Equal("Prizes", tournament.Summary);
        Assert.Equal("<p>Hello <strong>Legacy</strong><br></p>", tournament.BodyHtml);
        Assert.Equal("LEGACY CUP PRIZES LYON FRANCE", tournament.NormalizedSearchText);
        Assert.Equal(new LocalTime(23, 59, 59), tournament.VenueEndTime);
        Assert.Equal(new LocalDate(2026, 3, 29), tournament.VenueEndDate);
        Assert.True(tournament.EndsAtUtc > tournament.StartsAtUtc);
        Assert.Single(tournament.Formats);
    }

    [Fact]
    public void End_cannot_be_before_start_and_capacity_must_be_positive()
    {
        Assert.Throws<ArgumentException>(() => Create(Draft() with { EndsAtLocal = new LocalDateTime(2026, 8, 2, 9, 59) }));
        Assert.Throws<ArgumentOutOfRangeException>(() => Create(Draft() with { Capacity = 0 }));
    }

    [Fact]
    public void Dst_gap_is_rejected_and_overlap_is_accepted()
    {
        Assert.Throws<ArgumentException>(() => Create(Draft() with
        {
            TimeZoneId = "Europe/Paris",
            StartsAtLocal = new LocalDateTime(2026, 3, 29, 2, 30)
        }));

        var overlap = Create(Draft() with
        {
            TimeZoneId = "Europe/Paris",
            StartsAtLocal = new LocalDateTime(2026, 10, 25, 2, 30),
            EndsAtLocal = new LocalDateTime(2026, 10, 25, 4, 0)
        });

        Assert.Equal(Instant.FromUtc(2026, 10, 25, 0, 30), overlap.StartsAtUtc);
    }

    [Fact]
    public void Lifecycle_transitions_are_ordered()
    {
        var tournament = Create();
        tournament.AdvanceLifecycle(tournament.StartsAtUtc);
        Assert.Equal(ScheduledTournamentStatus.InProgress, tournament.Status);
        tournament.AdvanceLifecycle(tournament.EndsAtUtc);
        Assert.Equal(ScheduledTournamentStatus.Completed, tournament.Status);
    }

    [Fact]
    public void Cancel_is_allowed_before_during_or_after_tournament()
    {
        var published = Create();
        published.Cancel(Now);
        Assert.Equal(ScheduledTournamentStatus.Cancelled, published.Status);

        var inProgress = Create();
        inProgress.AdvanceLifecycle(inProgress.StartsAtUtc);
        inProgress.Cancel(inProgress.StartsAtUtc);
        Assert.Equal(ScheduledTournamentStatus.Cancelled, inProgress.Status);

        var completed = Create();
        completed.AdvanceLifecycle(completed.StartsAtUtc);
        completed.AdvanceLifecycle(completed.EndsAtUtc);
        completed.Cancel(completed.EndsAtUtc);
        Assert.Equal(ScheduledTournamentStatus.Cancelled, completed.Status);
        completed.AdvanceLifecycle(completed.EndsAtUtc + Duration.FromDays(1));
        Assert.Equal(ScheduledTournamentStatus.Cancelled, completed.Status);
    }

    [Fact]
    public void Edit_delete_and_restore_deadlines_are_before_start_only()
    {
        var tournament = Create();
        tournament.UpdateDetails(Draft() with { Title = "Updated" }, [TournamentFormat.CreateLegacy(Now)], Now);
        Assert.Equal("Updated", tournament.Title);
        Assert.Throws<InvalidOperationException>(() => tournament.UpdateDetails(Draft(), [TournamentFormat.CreateLegacy(Now)], tournament.StartsAtUtc));

        var deleted = Create();
        deleted.SoftDelete(UserId, "duplicate", Now);
        Assert.True(deleted.IsDeleted);
        Assert.Throws<InvalidOperationException>(() => deleted.UpdateDetails(Draft(), [TournamentFormat.CreateLegacy(Now)], Now));
        deleted.Restore(Now + Duration.FromMinutes(1));
        Assert.False(deleted.IsDeleted);

        var expired = Create();
        expired.SoftDelete(UserId, null, Now);
        Assert.Throws<InvalidOperationException>(() => expired.Restore(expired.StartsAtUtc));
    }

    [Fact]
    public void Major_change_classification_separates_content_from_schedule_and_venue()
    {
        var legacy = TournamentFormat.CreateLegacy(Now);
        var tournament = ScheduledTournament.Create(OrganizationId, UserId, Draft(), [legacy], Now);
        Assert.Equal(TournamentChangeSeverity.None, tournament.ClassifyChange(Draft(), [legacy]));
        Assert.Equal(TournamentChangeSeverity.Minor, tournament.ClassifyChange(Draft() with { Title = "Renamed Cup" }, [legacy]));
        Assert.Equal(TournamentChangeSeverity.Minor, tournament.ClassifyChange(Draft() with { Summary = "Side events" }, [legacy]));
        Assert.Equal(TournamentChangeSeverity.Minor, tournament.ClassifyChange(Draft() with { BodyHtml = "<p>Changed</p>" }, [legacy]));
        Assert.Equal(TournamentChangeSeverity.Major, tournament.ClassifyChange(Draft() with { StartsAtLocal = new LocalDateTime(2026, 8, 2, 11, 0) }, [legacy]));
        Assert.Equal(TournamentChangeSeverity.Major, tournament.ClassifyChange(Draft() with { City = "Paris" }, [legacy]));
    }

    [Theory]
    [InlineData("<script>alert(1)</script>")]
    [InlineData("<p style=\"color:red\">x</p>")]
    [InlineData("<p onclick=\"x()\">x</p>")]
    [InlineData("<img src=\"https://example.test/x.png\" />")]
    [InlineData("<a href=\"http://example.test\">x</a>")]
    [InlineData("<a href=\"/relative\">x</a>")]
    public void Sanitizer_rejects_unsupported_markup_and_urls(string html)
    {
        Assert.Throws<ArgumentException>(() => TournamentContentSanitizer.Sanitize(html));
    }

    [Fact]
    public void Sanitizer_allows_canonical_safe_markup()
    {
        var sanitized = TournamentContentSanitizer.Sanitize("<h2>Title</h2><p>See <a href=\"https://example.test/path?q=1\">rules</a></p><ul><li><em>One</em></li></ul>");
        Assert.Equal("<h2>Title</h2><p>See <a href=\"https://example.test/path?q=1\">rules</a></p><ul><li><em>One</em></li></ul>", sanitized);
    }

    private static ScheduledTournament Create(ScheduledTournamentDraft? draft = null) =>
        ScheduledTournament.Create(OrganizationId, UserId, draft ?? Draft(), [TournamentFormat.CreateLegacy(Now)], Now);

    private static ScheduledTournamentDraft Draft() => new(
        Title: "Legacy Cup",
        Slug: "legacy-cup",
        Summary: "Prizes",
        BodyHtml: "<p>Welcome</p>",
        StreetAddress: "12 Rue de la Paix",
        PostalCode: "69001",
        City: "Lyon",
        Country: "France",
        TimeZoneId: "Europe/Paris",
        StartsAtLocal: new LocalDateTime(2026, 8, 2, 10, 0),
        EndsAtLocal: new LocalDateTime(2026, 8, 2, 18, 0),
        Capacity: 64);
}
