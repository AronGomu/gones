using Gones.Domain.Calendar;
using Gones.Domain.Organizations;
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

    [Fact]
    public void Organizer_removal_is_distinct_terminal_status_with_actor_history()
    {
        var organizerId = Guid.NewGuid();
        var attempt = TournamentRegistrationAttempt.Register(TournamentId, UserId, organizerId, Now);

        attempt.RemoveByOrganizer(organizerId, Now + Duration.FromMinutes(1));

        Assert.Equal(TournamentRegistrationStatus.RemovedByOrganizer, attempt.Status);
        Assert.Equal(organizerId, attempt.RegisteredByUserId);
        Assert.Equal(organizerId, attempt.StatusChangedByUserId);
    }

    [Fact]
    public void Organization_block_tracks_reason_actor_expiry_then_explicit_unblock()
    {
        var organizationId = Guid.NewGuid();
        var actorId = Guid.NewGuid();
        var expiry = Now + Duration.FromDays(7);

        var block = OrganizationBlockedUser.Block(organizationId, UserId, "Repeated no-show", actorId, Now, expiry);

        Assert.True(block.AppliesAt(Now));
        Assert.False(block.AppliesAt(expiry));
        Assert.Equal("Repeated no-show", block.Reason);
        Assert.Equal(actorId, block.BlockedByUserId);
        block.Unblock(actorId, Now + Duration.FromDays(1));
        Assert.False(block.IsActive);
        Assert.Equal(actorId, block.UnblockedByUserId);
        Assert.Equal(Now + Duration.FromDays(1), block.UnblockedAt);
    }
}
