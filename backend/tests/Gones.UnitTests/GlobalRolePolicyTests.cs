using Gones.Domain.Identity;

namespace Gones.UnitTests;

public sealed class GlobalRolePolicyTests
{
    private static readonly Guid Actor = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Subject = Guid.Parse("22222222-2222-2222-2222-222222222222");

    [Fact]
    public void Grant_organizer_promotes_user()
    {
        var decision = GlobalRolePolicy.Evaluate(GlobalRoles.User, GlobalRoles.Organizer, GlobalRoleChangeKind.Grant, Actor, Subject, activeAdminCount: 1);
        Assert.True(decision.Allowed);
        Assert.Equal(GlobalRoles.Organizer, decision.ResultingRole);
    }

    [Fact]
    public void Grant_admin_promotes_organizer()
    {
        var decision = GlobalRolePolicy.Evaluate(GlobalRoles.Organizer, GlobalRoles.Admin, GlobalRoleChangeKind.Grant, Actor, Subject, activeAdminCount: 1);
        Assert.True(decision.Allowed);
        Assert.Equal(GlobalRoles.Admin, decision.ResultingRole);
    }

    [Fact]
    public void Grant_is_idempotent_when_already_at_or_above_target()
    {
        var decision = GlobalRolePolicy.Evaluate(GlobalRoles.Admin, GlobalRoles.Organizer, GlobalRoleChangeKind.Grant, Actor, Subject, activeAdminCount: 2);
        Assert.True(decision.Allowed);
        Assert.Equal(GlobalRoles.Admin, decision.ResultingRole);
    }

    [Fact]
    public void Revoke_admin_denies_self_lockout()
    {
        var decision = GlobalRolePolicy.Evaluate(GlobalRoles.Admin, GlobalRoles.Admin, GlobalRoleChangeKind.Revoke, Actor, Actor, activeAdminCount: 2);
        Assert.False(decision.Allowed);
        Assert.Equal("self_admin_lockout", decision.DenialCode);
    }

    [Fact]
    public void Revoke_admin_denies_last_admin()
    {
        var decision = GlobalRolePolicy.Evaluate(GlobalRoles.Admin, GlobalRoles.Admin, GlobalRoleChangeKind.Revoke, Actor, Subject, activeAdminCount: 1);
        Assert.False(decision.Allowed);
        Assert.Equal("last_admin", decision.DenialCode);
    }

    [Fact]
    public void Revoke_admin_demotes_to_user_when_another_admin_exists()
    {
        var decision = GlobalRolePolicy.Evaluate(GlobalRoles.Admin, GlobalRoles.Admin, GlobalRoleChangeKind.Revoke, Actor, Subject, activeAdminCount: 2);
        Assert.True(decision.Allowed);
        Assert.Equal(GlobalRoles.User, decision.ResultingRole);
    }

    [Fact]
    public void Revoke_organizer_from_admin_is_denied()
    {
        var decision = GlobalRolePolicy.Evaluate(GlobalRoles.Admin, GlobalRoles.Organizer, GlobalRoleChangeKind.Revoke, Actor, Subject, activeAdminCount: 2);
        Assert.False(decision.Allowed);
        Assert.Equal("admin_retains_organizer", decision.DenialCode);
    }

    [Fact]
    public void User_role_is_not_assignable_target()
    {
        var decision = GlobalRolePolicy.Evaluate(GlobalRoles.User, GlobalRoles.User, GlobalRoleChangeKind.Grant, Actor, Subject, activeAdminCount: 1);
        Assert.False(decision.Allowed);
        Assert.Equal("invalid_role", decision.DenialCode);
    }
}
