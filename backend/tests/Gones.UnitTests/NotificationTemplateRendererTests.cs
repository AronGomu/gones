using Gones.Application.Notifications;

namespace Gones.UnitTests;

public sealed class NotificationTemplateRendererTests
{
    public static TheoryData<NotificationTemplateModel> Models => new()
    {
        new VerifyEmailTemplateModel("Alice", new Uri("https://app.example/verify?token=secret-value")),
        new ResetPasswordTemplateModel("Alice", new Uri("https://app.example/reset?token=secret-value")),
        new RegistrationTemplateModel("Alice", "Legacy Lyon", new Uri("https://app.example/tournaments/legacy-lyon")),
        new UnregistrationTemplateModel("Alice", "Legacy Lyon", new Uri("https://app.example/tournaments/legacy-lyon")),
        new MajorUpdateTemplateModel("Alice", "Legacy Lyon", "Venue changed", new Uri("https://app.example/tournaments/legacy-lyon")),
        new CancellationTemplateModel("Alice", "Legacy Lyon", new Uri("https://app.example/tournaments/legacy-lyon")),
        new ReminderTemplateModel("Alice", "Legacy Lyon", new DateTimeOffset(2026, 8, 15, 12, 0, 0, TimeSpan.Zero), "UTC", new Uri("https://app.example/tournaments/legacy-lyon")),
        new OrganizerNoticeTemplateModel("Morgan", "Alice", "Legacy Lyon", "Registration received", new Uri("https://app.example/tournaments/legacy-lyon")),
        new TournamentProposalTemplateModel(
            "Morgan",
            "Alice",
            "Legacy Lyon",
            "Monthly legacy event",
            "12 Rue de la Paix, 75001 Lyon, France",
            "2035-03-04T10:00:00",
            "2035-03-04T18:00:00",
            "Europe/Paris",
            "Legacy",
            "64",
            new Uri("https://app.example/event-requests/secret-review-token")),
        new TournamentProposalRejectedTemplateModel(
            "Alice",
            "Legacy Lyon",
            "Morgan",
            "The venue is already booked that weekend.",
            new Uri("https://app.example/calendar"))
    };

    [Fact]
    public void Tournament_proposal_rejection_renders_the_reason_in_both_locales()
    {
        var renderer = new NotificationTemplateRenderer();
        var model = new TournamentProposalRejectedTemplateModel(
            "Alice",
            "Legacy Lyon",
            "Morgan",
            "The venue is already booked that weekend.",
            new Uri("https://app.example/calendar"));
        string[] fields = [model.SubmitterName, model.TournamentName, model.ApproverName, model.Reason, model.CalendarUrl.AbsoluteUri];

        var french = renderer.Render("fr", model);
        var english = renderer.Render("en", model);

        Assert.Equal("Demande de tournoi refusée", french.Subject);
        Assert.Equal("Tournament request declined", english.Subject);
        foreach (var rendered in new[] { french, english })
        {
            foreach (var field in fields)
            {
                Assert.Contains(field, rendered.TextBody, StringComparison.Ordinal);
                Assert.Contains(field, rendered.HtmlBody, StringComparison.Ordinal);
            }

            // The refusal reason is the approver's words about someone else's submission: the stored
            // preview keeps none of it.
            Assert.DoesNotContain("already booked", rendered.SafePreviewTextBody, StringComparison.Ordinal);
            Assert.DoesNotContain("already booked", rendered.SafePreviewHtmlBody, StringComparison.Ordinal);
        }

        Assert.NotEqual(french.TextBody, english.TextBody);
    }

    [Fact]
    public void Tournament_proposal_renders_every_submitted_field_in_both_locales()
    {
        var renderer = new NotificationTemplateRenderer();
        var model = new TournamentProposalTemplateModel(
            "Morgan",
            "Alice",
            "Legacy Lyon",
            "Monthly legacy event",
            "12 Rue de la Paix, 75001 Lyon, France",
            "2035-03-04T10:00:00",
            "2035-03-04T18:00:00",
            "Europe/Paris",
            "Legacy",
            "64",
            new Uri("https://app.example/event-requests/secret-review-token"));
        string[] fields =
        [
            model.ApproverName, model.SubmitterName, model.TournamentName, model.TournamentSummary,
            model.VenueAddress, model.StartsAt, model.EndsAt, model.TimeZoneId, model.Formats, model.Capacity,
            model.ReviewUrl.AbsoluteUri
        ];

        var french = renderer.Render("fr", model);
        var english = renderer.Render("en", model);

        Assert.Equal("Demande de validation de tournoi", french.Subject);
        Assert.Equal("Tournament approval request", english.Subject);
        foreach (var rendered in new[] { french, english })
        {
            foreach (var field in fields)
            {
                Assert.Contains(field, rendered.TextBody, StringComparison.Ordinal);
                Assert.Contains(field, rendered.HtmlBody, StringComparison.Ordinal);
            }

            // The stored preview must never carry the review token.
            Assert.DoesNotContain("secret-review-token", rendered.SafePreviewTextBody, StringComparison.Ordinal);
            Assert.DoesNotContain("secret-review-token", rendered.SafePreviewHtmlBody, StringComparison.Ordinal);
        }

        Assert.NotEqual(french.TextBody, english.TextBody);
    }

    [Theory]
    [MemberData(nameof(Models))]
    public void Every_template_renders_html_and_text_in_both_locales(NotificationTemplateModel model)
    {
        var renderer = new NotificationTemplateRenderer();

        foreach (var locale in new[] { "fr", "en" })
        {
            var rendered = renderer.Render(locale, model);

            Assert.NotEmpty(rendered.Subject);
            Assert.InRange(rendered.Subject.Length, 1, NotificationTemplateRenderer.MaxSubjectLength);
            Assert.NotEmpty(rendered.HtmlBody);
            Assert.NotEmpty(rendered.TextBody);
            Assert.DoesNotContain("{{", rendered.HtmlBody, StringComparison.Ordinal);
            Assert.DoesNotContain("{{", rendered.TextBody, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void Unsupported_locale_falls_back_to_french()
    {
        var renderer = new NotificationTemplateRenderer();
        var model = new VerifyEmailTemplateModel("Alice", new Uri("https://app.example/verify"));

        var fallback = renderer.Render("de-DE", model);
        var french = renderer.Render("fr", model);

        Assert.Equal(french.Subject, fallback.Subject);
        Assert.Equal(french.HtmlBody, fallback.HtmlBody);
        Assert.Equal(french.TextBody, fallback.TextBody);
    }

    [Fact]
    public void Html_values_are_encoded_and_text_stays_plain()
    {
        var renderer = new NotificationTemplateRenderer();
        var model = new RegistrationTemplateModel("<script>alert(1)</script>", "Legacy & Modern", new Uri("https://app.example/tournaments/test"));

        var rendered = renderer.Render("en", model);

        Assert.DoesNotContain("<script>", rendered.HtmlBody, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("&lt;script&gt;", rendered.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("Legacy &amp; Modern", rendered.HtmlBody, StringComparison.Ordinal);
        Assert.Contains("<script>alert(1)</script>", rendered.TextBody, StringComparison.Ordinal);
    }

    [Fact]
    public void Non_https_action_link_is_rejected()
    {
        var renderer = new NotificationTemplateRenderer();
        var model = new VerifyEmailTemplateModel("Alice", new Uri("http://app.example/verify"));

        var error = Assert.Throws<NotificationTemplateException>(() => renderer.Render("en", model));

        Assert.Equal("notification_link_must_be_https", error.Code);
    }

    [Fact]
    public void Safe_preview_does_not_contain_action_token_or_recipient_content()
    {
        var renderer = new NotificationTemplateRenderer();
        var model = new VerifyEmailTemplateModel("Alice", new Uri("https://app.example/verify?token=secret-value"));

        var rendered = renderer.Render("en", model);

        Assert.Contains("secret-value", rendered.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("secret-value", rendered.SafePreviewHtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("secret-value", rendered.SafePreviewTextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Alice", rendered.SafePreviewHtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("Alice", rendered.SafePreviewTextBody, StringComparison.Ordinal);
        Assert.Contains("https://preview.invalid/redacted", rendered.SafePreviewTextBody, StringComparison.Ordinal);
    }
}
