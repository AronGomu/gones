using Gones.Domain.Identity;

namespace Gones.UnitTests;

public sealed class AccountClosurePolicyTests
{
    private static readonly Guid Actor = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Subject = Guid.Parse("22222222-2222-2222-2222-222222222222");

    [Fact]
    public void Opaque_identity_values_are_stable_and_username_length_safe()
    {
        var username = AccountClosureIdentity.OpaqueUsername(Subject);
        var email = AccountClosureIdentity.OpaqueEmail(Subject);
        Assert.Equal(username, AccountClosureIdentity.OpaqueUsername(Subject));
        Assert.StartsWith("c-", username);
        Assert.True(username.Length is >= Username.MinimumLength and <= Username.MaximumLength);
        Assert.EndsWith("@closed.invalid", email);
        Assert.Contains(Subject.ToString("N"), email, StringComparison.Ordinal);
    }

    /// <summary>
    /// ADR 0041: the two ownership-shaped answers are gone. Only self-closure, the last admin and an
    /// already-closed account refuse, and nothing an organization can be in blocks a closure.
    /// </summary>
    [Fact]
    public void Blocks_self_last_admin_and_already_closed_only()
    {
        Assert.Equal("self_close", AccountClosurePolicy.EvaluateBlock(Actor, Actor, GlobalRoles.User, false, 2));
        Assert.Equal("already_closed", AccountClosurePolicy.EvaluateBlock(Actor, Subject, GlobalRoles.User, true, 2));
        Assert.Equal("last_admin", AccountClosurePolicy.EvaluateBlock(Actor, Subject, GlobalRoles.Admin, false, 1));
        Assert.Null(AccountClosurePolicy.EvaluateBlock(Actor, Subject, GlobalRoles.User, false, 2));
        Assert.Null(AccountClosurePolicy.EvaluateBlock(Actor, Subject, GlobalRoles.Admin, false, 2));
    }

    [Fact]
    public void Profile_close_anonymizes_pii_once()
    {
        var now = NodaTime.SystemClock.Instance.GetCurrentInstant();
        var profile = UserProfile.Create(Subject, "owner-user", "Ada", "Lovelace", now);
        profile.Update(
            "owner-user", "Ada", "Lovelace",
            "France", "Île-de-France", "Paris", new NodaTime.LocalDate(1990, 4, 17),
            "en", true, true, true, true, true,
            now.InUtc().Date, now);
        profile.CloseAndAnonymize(AccountClosureIdentity.OpaqueUsername(Subject), now);
        Assert.True(profile.IsClosed);
        Assert.Equal(AccountClosureIdentity.OpaqueUsername(Subject), profile.Username);
        Assert.Equal("Closed", profile.FirstName);
        Assert.Equal("User", profile.LastName);
        Assert.Null(profile.LocationCountry);
        Assert.Null(profile.LocationRegion);
        Assert.Null(profile.LocationCity);
        Assert.Null(profile.BirthDate);
        Assert.False(profile.IsFirstNamePublic);
        var closedAt = profile.ClosedAt;
        profile.CloseAndAnonymize("ignored", now.Plus(NodaTime.Duration.FromMinutes(1)));
        Assert.Equal(closedAt, profile.ClosedAt);
    }
}
