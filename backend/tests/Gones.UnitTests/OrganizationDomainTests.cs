using Gones.Domain.Organizations;
using NodaTime;

namespace Gones.UnitTests;

public sealed class OrganizationDomainTests
{
    private static readonly Instant Now = Instant.FromUtc(2026, 8, 1, 12, 0);

    [Fact]
    public void Create_normalizes_name_and_defaults_notification_settings()
    {
        var organization = Organization.Create("  Gones Club ", "desc", "https://example.test", "club@example.test", Now);
        Assert.Equal("Gones Club", organization.Name);
        Assert.Equal("GONES CLUB", organization.NormalizedName);
        Assert.True(organization.IsActive);

        var settings = OrganizationNotificationSettings.CreateDefault(organization.Id, Now);
        Assert.False(settings.NotifyOnRegistration);
        Assert.False(settings.NotifyOnUnregistration);
    }

    [Fact]
    public void Name_must_be_unique_shape_and_non_empty()
    {
        Assert.Throws<ArgumentException>(() => Organization.ValidateName(" "));
        Assert.Throws<ArgumentException>(() => Organization.ValidateName(new string('a', Organization.MaximumNameLength + 1)));
        Assert.Equal("AB", Organization.NormalizeName(" ab "));
    }

    [Fact]
    public void Soft_delete_and_restore_toggle_active_flag()
    {
        var organization = Organization.Create("Club", null, null, null, Now);
        organization.SoftDelete(Now.Plus(Duration.FromMinutes(1)));
        Assert.False(organization.IsActive);
        Assert.Throws<InvalidOperationException>(() => organization.Update("Other", null, null, null, Now));

        organization.Restore(Now.Plus(Duration.FromMinutes(2)));
        Assert.True(organization.IsActive);
        organization.Update("Other", null, null, null, Now.Plus(Duration.FromMinutes(3)));
        Assert.Equal("Other", organization.Name);
    }

    /// <summary>ADR 0041: <c>Organizer</c> is the only membership role there is.</summary>
    [Fact]
    public void Organizer_is_the_only_membership_role()
    {
        Assert.Equal([OrganizationRoles.Organizer], OrganizationRoles.All);
        Assert.True(OrganizationRoles.IsKnown(OrganizationRoles.Organizer));
        Assert.False(OrganizationRoles.IsKnown("Owner"));

        var member = OrganizationMember.Create(Guid.NewGuid(), Guid.NewGuid(), OrganizationRoles.Organizer, Now);
        Assert.Equal(OrganizationRoles.Organizer, member.Role);
        Assert.Throws<ArgumentException>(() => OrganizationMember.Create(Guid.NewGuid(), Guid.NewGuid(), "Owner", Now));
        Assert.Throws<ArgumentException>(() => OrganizationMember.Create(Guid.NewGuid(), Guid.NewGuid(), "Admin", Now));
        Assert.Throws<ArgumentException>(() => member.ChangeRole("Owner", Now));
    }

    [Fact]
    public void Notification_settings_update_flags()
    {
        var settings = OrganizationNotificationSettings.CreateDefault(Guid.NewGuid(), Now);
        settings.Update(notifyOnRegistration: true, notifyOnUnregistration: true, Now.Plus(Duration.FromSeconds(1)));
        Assert.True(settings.NotifyOnRegistration);
        Assert.True(settings.NotifyOnUnregistration);
    }

    [Theory]
    [InlineData("not-a-url")]
    [InlineData("ftp://example.test")]
    public void Website_must_be_http_or_https(string website)
    {
        Assert.Throws<ArgumentException>(() => Organization.Create("Club", null, website, null, Now));
    }

    [Fact]
    public void Contact_email_must_be_valid_when_present()
    {
        Assert.Throws<ArgumentException>(() => Organization.Create("Club", null, null, "not-email", Now));
    }
}
