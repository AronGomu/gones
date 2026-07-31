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
        new ReminderTemplateModel("Alice", "Legacy Lyon", new DateTimeOffset(2026, 8, 15, 12, 0, 0, TimeSpan.Zero), "Europe/Paris", new Uri("https://app.example/tournaments/legacy-lyon")),
        new OrganizerNoticeTemplateModel("Morgan", "Alice", "Legacy Lyon", "Registration received", new Uri("https://app.example/tournaments/legacy-lyon"))
    };

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
