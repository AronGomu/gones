using Gones.Domain.Identity;
using NodaTime;

namespace Gones.UnitTests;

public sealed class AccountLifecycleTests
{
    private static readonly Instant Now = Instant.FromUtc(2026, 8, 1, 12, 0);

    [Fact]
    public void Verification_token_expires_after_exactly_24_hours()
    {
        var token = AccountActionToken.Create(Guid.NewGuid(), AccountActionPurpose.VerifyEmail, new string('a', 64), "stamp", null, null, Now);

        Assert.Equal(Now + Duration.FromHours(24), token.ExpiresAt);
        Assert.True(token.CanConsume(Now + Duration.FromHours(24) - Duration.FromMilliseconds(1), "stamp"));
        Assert.False(token.CanConsume(Now + Duration.FromHours(24), "stamp"));
    }

    [Fact]
    public void Token_is_single_use_and_security_stamp_bound()
    {
        var token = AccountActionToken.Create(Guid.NewGuid(), AccountActionPurpose.ResetPassword, new string('b', 64), "stamp", null, null, Now);

        Assert.False(token.CanConsume(Now, "other"));
        Assert.True(token.CanConsume(Now, "stamp"));
        token.Consume(Now);
        Assert.False(token.CanConsume(Now, "stamp"));
    }

    [Fact]
    public void Email_history_redaction_is_idempotent()
    {
        var history = UserEmailHistory.Create(Guid.NewGuid(), "old@example.test", Now);
        var due = history.RetainUntil;

        Assert.True(history.Redact(due));
        Assert.Null(history.Email);
        Assert.Equal(due, history.RedactedAt);
        Assert.False(history.Redact(due + Duration.FromDays(1)));
    }
}
