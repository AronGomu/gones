using Gones.Domain.Identity;
using Gones.Domain.Organizations;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using Testcontainers.PostgreSql;

namespace Gones.IntegrationTests;

/// <summary>
/// The one-shot heal migration, exercised the way it will actually run: the database is first
/// migrated to the revision that precedes it, the legacy violations are written into that schema,
/// and only then is the heal applied. Seeding after a full <c>MigrateAsync()</c> would prove
/// nothing, because the heal would already have run against an empty database.
///
/// The heal carries no schema change, so the pre-heal and post-heal schemas are identical and the
/// fixture can be seeded through the normal DbContext.
/// </summary>
public sealed class OrganizationMembershipHealTests : IAsyncLifetime
{
    /// <summary>The revision immediately before <c>HealOrganizationMembershipInvariants</c>.</summary>
    private const string BeforeHeal = "20260809122735_RenameLeagueArchiveTables";

    private static readonly Instant Now = Instant.FromUtc(2026, 8, 12, 9, 0);

    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder().WithImage("postgres:17-alpine").Build();

    private Guid emptyOrganizationId;
    private Guid staffedOrganizationId;
    private Guid organizerWithoutMembershipId;
    private Guid organizerWithMembershipId;
    private Guid adminWithoutMembershipId;
    private Guid adminWithMembershipId;
    private Guid memberWithUserRoleId;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var db = CreateContext();
        await db.Database.MigrateAsync(BeforeHeal);
        await SeedLegacyViolationsAsync(db);
        await db.Database.MigrateAsync();
    }

    public Task DisposeAsync() => postgres.DisposeAsync().AsTask();

    [Fact]
    public async Task Member_less_organizations_are_soft_deleted()
    {
        await using var db = CreateContext();
        var organization = await db.Organizations.SingleAsync(item => item.Id == emptyOrganizationId);
        Assert.NotNull(organization.DeletedAt);
    }

    [Fact]
    public async Task Staffed_organizations_are_untouched()
    {
        await using var db = CreateContext();
        var organization = await db.Organizations.SingleAsync(item => item.Id == staffedOrganizationId);
        Assert.Null(organization.DeletedAt);
    }

    [Fact]
    public async Task Organizers_without_membership_are_demoted()
    {
        await using var db = CreateContext();
        var user = await db.Users.SingleAsync(item => item.Id == organizerWithoutMembershipId);
        Assert.Equal(GlobalRoles.User, user.GlobalRole);
        Assert.NotEqual(SeededSecurityStamp, user.SecurityStamp);
    }

    [Fact]
    public async Task Organizers_with_membership_keep_the_role()
    {
        await using var db = CreateContext();
        var user = await db.Users.SingleAsync(item => item.Id == organizerWithMembershipId);
        Assert.Equal(GlobalRoles.Organizer, user.GlobalRole);
        Assert.Equal(SeededSecurityStamp, user.SecurityStamp);
    }

    [Fact]
    public async Task Admins_are_never_demoted()
    {
        await using var db = CreateContext();
        var withoutMembership = await db.Users.SingleAsync(item => item.Id == adminWithoutMembershipId);
        var withMembership = await db.Users.SingleAsync(item => item.Id == adminWithMembershipId);
        Assert.Equal(GlobalRoles.Admin, withoutMembership.GlobalRole);
        Assert.Equal(GlobalRoles.Admin, withMembership.GlobalRole);
        Assert.Equal(SeededSecurityStamp, withoutMembership.SecurityStamp);
    }

    /// <summary>
    /// The heal only demotes. A member whose role never caught up stays a <c>User</c> until the next
    /// membership write runs the derivation: a migration must not hand out a privilege nobody asked
    /// for, and no membership is ever invented to justify a role.
    /// </summary>
    [Fact]
    public async Task Members_holding_the_plain_role_are_not_promoted()
    {
        await using var db = CreateContext();
        var user = await db.Users.SingleAsync(item => item.Id == memberWithUserRoleId);
        Assert.Equal(GlobalRoles.User, user.GlobalRole);
        Assert.Single(await db.OrganizationMembers.Where(member => member.UserId == memberWithUserRoleId).ToListAsync());
    }

    [Fact]
    public async Task Each_change_writes_an_audit_record()
    {
        await using var db = CreateContext();
        var archived = await db.AuditRecords
            .Where(record => record.Action == "organization.healed.archived")
            .ToListAsync();
        var demoted = await db.AuditRecords
            .Where(record => record.Action == "organization.healed.demoted")
            .ToListAsync();

        var archivedRecord = Assert.Single(archived);
        Assert.Equal("organization", archivedRecord.EntityType);
        Assert.Equal(emptyOrganizationId.ToString("D"), archivedRecord.EntityId);
        Assert.Null(archivedRecord.ActorId);
        Assert.Contains("\"no_members\"", archivedRecord.RedactedDiff, StringComparison.Ordinal);

        var demotedRecord = Assert.Single(demoted);
        Assert.Equal("user", demotedRecord.EntityType);
        Assert.Equal(organizerWithoutMembershipId.ToString("D"), demotedRecord.EntityId);
        Assert.Null(demotedRecord.ActorId);
        Assert.Contains("\"no_membership\"", demotedRecord.RedactedDiff, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Re_running_migrations_changes_nothing()
    {
        await using var db = CreateContext();
        var before = await SnapshotAsync(db);

        await db.Database.MigrateAsync();

        await using var reread = CreateContext();
        Assert.Equal(before, await SnapshotAsync(reread));
    }

    /// <summary>Everything the heal is allowed to move, in one comparable shape.</summary>
    private static async Task<string> SnapshotAsync(GonesDbContext db)
    {
        var organizations = await db.Organizations
            .OrderBy(organization => organization.Id)
            .Select(organization => $"{organization.Id:D}={organization.DeletedAt}")
            .ToListAsync();
        var users = await db.Users
            .OrderBy(user => user.Id)
            .Select(user => $"{user.Id:D}={user.GlobalRole}/{user.SecurityStamp}")
            .ToListAsync();
        var audits = await db.AuditRecords
            .Where(record => record.Action.StartsWith("organization.healed."))
            .OrderBy(record => record.Id)
            .Select(record => $"{record.Action}:{record.EntityId}")
            .ToListAsync();
        return string.Join("|", organizations.Concat(users).Concat(audits));
    }

    private const string SeededSecurityStamp = "seeded-security-stamp";

    private async Task SeedLegacyViolationsAsync(GonesDbContext db)
    {
        var emptyOrganization = Organization.Create($"Empty {Guid.NewGuid():N}", null, null, null, Now);
        var staffedOrganization = Organization.Create($"Staffed {Guid.NewGuid():N}", null, null, null, Now);
        var organizerWithoutMembership = NewUser(GlobalRoles.Organizer);
        var organizerWithMembership = NewUser(GlobalRoles.Organizer);
        var adminWithoutMembership = NewUser(GlobalRoles.Admin);
        var adminWithMembership = NewUser(GlobalRoles.Admin);
        var memberWithUserRole = NewUser(GlobalRoles.User);

        db.Organizations.AddRange(emptyOrganization, staffedOrganization);
        db.Users.AddRange(
            organizerWithoutMembership,
            organizerWithMembership,
            adminWithoutMembership,
            adminWithMembership,
            memberWithUserRole);
        await db.SaveChangesAsync();

        db.OrganizationMembers.AddRange(
            OrganizationMember.Create(staffedOrganization.Id, organizerWithMembership.Id, OrganizationRoles.Owner, Now),
            OrganizationMember.Create(staffedOrganization.Id, adminWithMembership.Id, OrganizationRoles.Organizer, Now),
            OrganizationMember.Create(staffedOrganization.Id, memberWithUserRole.Id, OrganizationRoles.Organizer, Now));
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        emptyOrganizationId = emptyOrganization.Id;
        staffedOrganizationId = staffedOrganization.Id;
        organizerWithoutMembershipId = organizerWithoutMembership.Id;
        organizerWithMembershipId = organizerWithMembership.Id;
        adminWithoutMembershipId = adminWithoutMembership.Id;
        adminWithMembershipId = adminWithMembership.Id;
        memberWithUserRoleId = memberWithUserRole.Id;
    }

    private static ApplicationUser NewUser(string globalRole)
    {
        var handle = $"heal-{Guid.NewGuid():N}@example.test";
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(),
            UserName = handle,
            NormalizedUserName = handle.ToUpperInvariant(),
            Email = handle,
            NormalizedEmail = handle.ToUpperInvariant(),
            EmailConfirmed = true,
            SecurityStamp = SeededSecurityStamp,
            ConcurrencyStamp = Guid.NewGuid().ToString("N")
        };
        user.AssignGlobalRole(globalRole);
        return user;
    }

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>()
            .ConfigureGones(postgres.GetConnectionString())
            .Options;
        return new GonesDbContext(options);
    }
}
