using Gones.Domain.Identity;

namespace Gones.UnitTests;

public sealed class AdminBootstrapPolicyTests
{
    [Fact]
    public void Configured_email_must_match_request()
    {
        AdminBootstrapPolicy.EnsureConfiguredEmailMatches("Admin@Example.test", "admin@example.test");
        Assert.Throws<InvalidOperationException>(() =>
            AdminBootstrapPolicy.EnsureConfiguredEmailMatches("other@example.test", "admin@example.test"));
        Assert.Throws<InvalidOperationException>(() =>
            AdminBootstrapPolicy.EnsureConfiguredEmailMatches(null, "admin@example.test"));
    }

    [Fact]
    public void Decide_promotes_when_marker_free_and_not_admin()
    {
        var decision = AdminBootstrapPolicy.Decide(markerConsumed: false, userIsAdmin: false, "admin@example.test");
        Assert.Equal(AdminBootstrapOutcome.Promoted, decision.Outcome);
        Assert.True(decision.IsSuccess);
        Assert.Equal(0, decision.ExitCode);
    }

    [Fact]
    public void Decide_is_safe_noop_when_marker_consumed()
    {
        var alreadyAdmin = AdminBootstrapPolicy.Decide(markerConsumed: true, userIsAdmin: true, "admin@example.test");
        var otherUser = AdminBootstrapPolicy.Decide(markerConsumed: true, userIsAdmin: false, "admin@example.test");
        Assert.Equal(AdminBootstrapOutcome.AlreadyAdminNoOp, alreadyAdmin.Outcome);
        Assert.Equal(AdminBootstrapOutcome.AlreadyConsumedNoOp, otherUser.Outcome);
        Assert.True(alreadyAdmin.IsSuccess);
        Assert.True(otherUser.IsSuccess);
    }
}
