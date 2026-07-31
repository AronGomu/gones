using Gones.Application.Notifications;
using NodaTime;

namespace Gones.UnitTests;

public sealed class NotificationRetryPolicyTests
{
    [Theory]
    [InlineData(1, 1)]
    [InlineData(2, 5)]
    [InlineData(3, 30)]
    [InlineData(4, 120)]
    [InlineData(5, 720)]
    public void Transient_attempts_use_bounded_retry_schedule(int attempt, int expectedMinutes)
    {
        var decision = DefaultNotificationRetryPolicy.Instance.Decide(attempt);

        Assert.True(decision.ShouldRetry);
        Assert.Equal(Duration.FromMinutes(expectedMinutes), decision.Delay);
    }

    [Fact]
    public void Attempts_after_schedule_are_dead_lettered()
    {
        var decision = DefaultNotificationRetryPolicy.Instance.Decide(6);

        Assert.False(decision.ShouldRetry);
        Assert.Equal(Duration.Zero, decision.Delay);
    }

    [Fact]
    public void Transport_error_codes_reject_log_injection_characters()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new EmailTransportException("bad\ncode", isTransient: true));
    }
}
