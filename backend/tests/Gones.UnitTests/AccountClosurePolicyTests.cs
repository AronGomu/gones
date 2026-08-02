using Gones.Domain.Identity;

namespace Gones.UnitTests;

public sealed class AccountClosurePolicyTests
{
    private static readonly Guid Actor = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Subject = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid OrgA = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid OrgB = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

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

    [Fact]
    public void Blocks_self_last_admin_already_closed_and_missing_transfers()
    {
        Assert.Equal("self_close", AccountClosurePolicy.EvaluateBlock(Actor, Actor, GlobalRoles.User, false, 2, [], new HashSet<Guid>()));
        Assert.Equal("already_closed", AccountClosurePolicy.EvaluateBlock(Actor, Subject, GlobalRoles.User, true, 2, [], new HashSet<Guid>()));
        Assert.Equal("last_admin", AccountClosurePolicy.EvaluateBlock(Actor, Subject, GlobalRoles.Admin, false, 1, [], new HashSet<Guid>()));
        Assert.Equal(
            "missing_owner_transfer",
            AccountClosurePolicy.EvaluateBlock(Actor, Subject, GlobalRoles.User, false, 2, [OrgA, OrgB], new HashSet<Guid> { OrgA }));
        Assert.Null(AccountClosurePolicy.EvaluateBlock(Actor, Subject, GlobalRoles.User, false, 2, [OrgA], new HashSet<Guid> { OrgA }));
    }

    [Fact]
    public void Profile_close_anonymizes_pii_once()
    {
        var now = NodaTime.SystemClock.Instance.GetCurrentInstant();
        var profile = UserProfile.Create(Subject, "owner-user", "Ada", "Lovelace", now);
        profile.Update("owner-user", "Ada", "Lovelace", "Paris", 1990, "en", true, true, true, true, true, 2026, now);
        profile.CloseAndAnonymize(AccountClosureIdentity.OpaqueUsername(Subject), now);
        Assert.True(profile.IsClosed);
        Assert.Equal(AccountClosureIdentity.OpaqueUsername(Subject), profile.Username);
        Assert.Equal("Closed", profile.FirstName);
        Assert.Equal("User", profile.LastName);
        Assert.Null(profile.Location);
        Assert.Null(profile.BirthYear);
        Assert.False(profile.IsFirstNamePublic);
        var closedAt = profile.ClosedAt;
        profile.CloseAndAnonymize("ignored", now.Plus(NodaTime.Duration.FromMinutes(1)));
        Assert.Equal(closedAt, profile.ClosedAt);
    }
}
