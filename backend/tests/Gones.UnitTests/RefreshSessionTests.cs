using Gones.Domain.Identity;
using NodaTime;

namespace Gones.UnitTests;

public sealed class RefreshSessionTests
{
    private static readonly Instant Now = Instant.FromUtc(2026, 8, 1, 12, 0);

    [Fact]
    public void Session_uses_seven_day_idle_and_thirty_day_absolute_expiry()
    {
        var session = RefreshSession.Create(Guid.NewGuid(), "security-stamp", "Firefox on Linux", Now);

        Assert.Equal(Now + Duration.FromDays(7), session.IdleExpiresAt);
        Assert.Equal(Now + Duration.FromDays(30), session.AbsoluteExpiresAt);
        Assert.True(session.CanRefresh(Now + Duration.FromDays(6), "security-stamp"));
        Assert.False(session.CanRefresh(Now + Duration.FromDays(7), "security-stamp"));
        Assert.False(session.CanRefresh(Now + Duration.FromDays(30), "security-stamp"));
    }

    [Fact]
    public void Rotation_moves_idle_expiry_without_extending_absolute_expiry()
    {
        var session = RefreshSession.Create(Guid.NewGuid(), "security-stamp", "Firefox on Linux", Now);
        var rotationTime = Now + Duration.FromDays(6);

        session.RecordRotation(rotationTime);

        Assert.Equal(rotationTime, session.LastUsedAt);
        Assert.Equal(rotationTime + Duration.FromDays(7), session.IdleExpiresAt);
        Assert.Equal(Now + Duration.FromDays(30), session.AbsoluteExpiresAt);

        foreach (var day in new[] { 12, 18, 24, 29 }) session.RecordRotation(Now + Duration.FromDays(day));
        Assert.Equal(Now + Duration.FromDays(30), session.IdleExpiresAt);
        Assert.True(session.CanRefresh(Now + Duration.FromDays(30) - Duration.FromSeconds(1), "security-stamp"));
        Assert.False(session.CanRefresh(Now + Duration.FromDays(30), "security-stamp"));
    }

    [Fact]
    public void Revocation_and_security_stamp_change_prevent_refresh()
    {
        var session = RefreshSession.Create(Guid.NewGuid(), "security-stamp", "Firefox on Linux", Now);

        Assert.False(session.CanRefresh(Now + Duration.FromHours(1), "changed-stamp"));
        session.Revoke(Now + Duration.FromHours(2), RefreshSessionRevocationReason.Logout);
        Assert.False(session.CanRefresh(Now + Duration.FromHours(3), "security-stamp"));
    }

    [Fact]
    public void Device_label_is_trimmed_bounded_and_never_empty()
    {
        var session = RefreshSession.Create(Guid.NewGuid(), "security-stamp", "  Firefox on Linux  ", Now);

        Assert.Equal("Firefox on Linux", session.DeviceLabel);
        Assert.Throws<ArgumentException>(() => RefreshSession.Create(Guid.NewGuid(), "security-stamp", " ", Now));
        Assert.Throws<ArgumentException>(() => RefreshSession.Create(Guid.NewGuid(), "security-stamp", new string('x', 101), Now));
    }
}
