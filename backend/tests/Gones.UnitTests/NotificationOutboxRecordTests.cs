using Gones.Domain.Notifications;
using NodaTime;

namespace Gones.UnitTests;

public sealed class NotificationOutboxRecordTests
{
    private static readonly Instant Now = Instant.FromUtc(2026, 7, 31, 12, 0);

    [Fact]
    public void Sent_transition_requires_current_lease_and_scrubs_sensitive_fields()
    {
        var record = CreateRecord();
        var lease = record.Claim(Now, Duration.FromMinutes(2));

        record.MarkSent(lease, Now + Duration.FromSeconds(10));

        Assert.Equal(NotificationOutboxStatus.Sent, record.Status);
        Assert.Equal(Now + Duration.FromSeconds(10), record.SentAt);
        Assert.Equal(Now + Duration.FromSeconds(10), record.ScrubbedAt);
        Assert.Null(record.Recipient);
        Assert.Null(record.TemplateModelJson);
        Assert.Null(record.LeaseToken);
        Assert.Null(record.LeaseExpiresAt);
    }

    [Fact]
    public void Transient_failure_returns_to_pending_with_retry_time()
    {
        var record = CreateRecord();
        var lease = record.Claim(Now, Duration.FromMinutes(2));
        var retryAt = Now + Duration.FromMinutes(5);

        record.MarkRetry(lease, retryAt, "transport_timeout");

        Assert.Equal(NotificationOutboxStatus.Pending, record.Status);
        Assert.Equal(retryAt, record.AvailableAt);
        Assert.Equal("transport_timeout", record.LastErrorCode);
        Assert.NotNull(record.Recipient);
        Assert.NotNull(record.TemplateModelJson);
        Assert.Null(record.LeaseToken);
    }

    [Fact]
    public void Expired_sending_lease_can_be_recovered_with_new_owner()
    {
        var record = CreateRecord();
        var firstLease = record.Claim(Now, Duration.FromMinutes(2));

        var secondLease = record.Claim(Now + Duration.FromMinutes(2), Duration.FromMinutes(2));

        Assert.NotEqual(firstLease, secondLease);
        Assert.Equal(2, record.AttemptCount);
        Assert.Equal(secondLease, record.LeaseToken);
    }

    [Fact]
    public void Active_sending_lease_cannot_be_reclaimed()
    {
        var record = CreateRecord();
        record.Claim(Now, Duration.FromMinutes(2));

        var error = Assert.Throws<InvalidOperationException>(() => record.Claim(Now + Duration.FromMinutes(1), Duration.FromMinutes(2)));

        Assert.Equal("notification_not_claimable", error.Message);
    }

    [Fact]
    public void Stale_lease_cannot_complete_delivery()
    {
        var record = CreateRecord();
        var firstLease = record.Claim(Now, Duration.FromMinutes(1));
        record.Claim(Now + Duration.FromMinutes(1), Duration.FromMinutes(1));

        var error = Assert.Throws<InvalidOperationException>(() => record.MarkSent(firstLease, Now + Duration.FromMinutes(1)));

        Assert.Equal("notification_lease_lost", error.Message);
    }

    [Fact]
    public void Dead_letter_transition_scrubs_sensitive_fields()
    {
        var record = CreateRecord();
        var lease = record.Claim(Now, Duration.FromMinutes(2));

        record.MarkDeadLetter(lease, Now + Duration.FromSeconds(5), "recipient_rejected");

        Assert.Equal(NotificationOutboxStatus.DeadLetter, record.Status);
        Assert.Equal(Now + Duration.FromSeconds(5), record.DeadLetteredAt);
        Assert.Equal(Now + Duration.FromSeconds(5), record.ScrubbedAt);
        Assert.Equal("recipient_rejected", record.LastErrorCode);
        Assert.Null(record.Recipient);
        Assert.Null(record.TemplateModelJson);
    }

    private static NotificationOutboxRecord CreateRecord() => new(
        "dedupe-key",
        "verify-email",
        "en",
        "alice@example.test",
        "{}",
        null,
        null,
        Now);
}
