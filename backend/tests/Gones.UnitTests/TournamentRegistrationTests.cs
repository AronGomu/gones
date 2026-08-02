using Gones.Domain.Calendar;
using NodaTime;

namespace Gones.UnitTests;

public sealed class TournamentRegistrationTests
{
    private static readonly Guid TournamentId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();
    private static readonly Instant Now = Instant.FromUtc(2030, 1, 1, 12, 0);

    [Fact]
    public void Confirmed_attempt_can_be_cancelled_by_user_once()
    {
        var attempt = TournamentRegistrationAttempt.Register(TournamentId, UserId, UserId, Now);

        attempt.CancelByUser(UserId, Now + Duration.FromMinutes(1));

        Assert.Equal(TournamentRegistrationStatus.CancelledByUser, attempt.Status);
        Assert.Equal(UserId, attempt.StatusChangedByUserId);
        Assert.Equal(Now + Duration.FromMinutes(1), attempt.StatusChangedAt);
        Assert.Throws<InvalidOperationException>(() => attempt.CancelByUser(UserId, Now + Duration.FromMinutes(2)));
    }

    [Fact]
    public void Tournament_cancellation_is_terminal_and_preserves_registration_actor_history()
    {
        var attempt = TournamentRegistrationAttempt.Register(TournamentId, UserId, UserId, Now);
        var organizerId = Guid.NewGuid();

        attempt.CancelByTournament(organizerId, Now + Duration.FromMinutes(1));

        Assert.Equal(TournamentRegistrationStatus.CancelledByTournament, attempt.Status);
        Assert.Equal(UserId, attempt.RegisteredByUserId);
        Assert.Equal(Now, attempt.RegisteredAt);
        Assert.Equal(organizerId, attempt.StatusChangedByUserId);
    }
}
