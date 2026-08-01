using Gones.Domain.Identity;
using NodaTime;

namespace Gones.UnitTests;

public sealed class ExternalIdentityTests
{
    private static readonly Instant Now = Instant.FromUtc(2026, 8, 1, 12, 0);
    private static readonly string StateHash = new('a', 64);
    private static readonly string CorrelationHash = new('b', 64);

    [Fact]
    public void State_is_short_lived_bound_and_one_time()
    {
        var attempt = OAuthAttempt.Create("Google", OAuthAttemptPurpose.Register, null, StateHash, CorrelationHash, Now);

        Assert.True(attempt.CanAcceptCallback(CorrelationHash, Now + Duration.FromMinutes(4)));
        Assert.False(attempt.CanAcceptCallback(new string('c', 64), Now + Duration.FromMinutes(4)));
        Assert.False(attempt.CanAcceptCallback(CorrelationHash, Now + OAuthAttempt.StateLifetime));

        attempt.ClaimCallback(CorrelationHash, Now + Duration.FromMinutes(1));
        Assert.False(attempt.CanAcceptCallback(CorrelationHash, Now + Duration.FromMinutes(1)));
    }

    [Fact]
    public void Completion_and_email_verification_tickets_transition_once()
    {
        var attempt = OAuthAttempt.Create("facebook", OAuthAttemptPurpose.Register, null, StateHash, CorrelationHash, Now);
        attempt.ClaimCallback(CorrelationHash, Now);
        attempt.CaptureProfile("provider-subject", "provider@example.test", false);
        var completionHash = new string('c', 64);
        attempt.AwaitCompletion(completionHash, Now);

        Assert.True(attempt.CanComplete(completionHash, Now + Duration.FromMinutes(9)));
        Assert.False(attempt.CanComplete(completionHash, Now + OAuthAttempt.CompletionLifetime));

        var verificationHash = new string('d', 64);
        attempt.AwaitEmailVerification(verificationHash, "collected@example.test", "PlayerOne", "Alice", "Martin", Now);
        Assert.False(attempt.CanComplete(completionHash, Now));
        Assert.True(attempt.CanVerifyEmail(verificationHash, Now + Duration.FromHours(23)));
        attempt.Consume(Now + Duration.FromHours(1));
        Assert.False(attempt.CanVerifyEmail(verificationHash, Now + Duration.FromHours(1)));
    }

    [Fact]
    public void External_identity_normalizes_provider_and_updates_email_metadata_only()
    {
        var identity = ExternalIdentity.Create(Guid.NewGuid(), "Google", " provider-subject ", "first@example.test", true, Now);

        identity.UpdateProviderEmail("changed@example.test", false, Now + Duration.FromMinutes(1));

        Assert.Equal("google", identity.Provider);
        Assert.Equal("provider-subject", identity.ProviderSubject);
        Assert.Equal("changed@example.test", identity.ProviderEmail);
        Assert.False(identity.ProviderEmailVerified);
    }
}
