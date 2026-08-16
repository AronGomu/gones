using Gones.Domain.Identity;
using Gones.Domain.Organizations;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Gones.Infrastructure.Persistence.Migrations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Microsoft.EntityFrameworkCore.Storage;
using NodaTime;

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

    private readonly PostgreSqlTestContainer postgres = new();

    private Guid emptyOrganizationId;
    private Guid staffedOrganizationId;
    private Guid archivedOrganizationId;
    private Guid organizerWithoutMembershipId;
    private Guid organizerWithArchivedMembershipOnlyId;
    private Guid adminWithArchivedMembershipOnlyId;
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

    /// <summary>
    /// The case the first heal missed: the account holds a membership row, so
    /// <c>id NOT IN (SELECT user_id FROM organization_members)</c> skipped it, but the organization
    /// behind that row is archived - which is exactly the state the runtime rule calls a violation.
    /// </summary>
    [Fact]
    public async Task Organizers_whose_only_membership_is_in_an_archived_organization_are_demoted()
    {
        await using var db = CreateContext();
        var user = await db.Users.SingleAsync(item => item.Id == organizerWithArchivedMembershipOnlyId);
        Assert.Equal(GlobalRoles.User, user.GlobalRole);
        Assert.NotEqual(SeededSecurityStamp, user.SecurityStamp);

        // Only the role moved: the membership row and the archived organization are left alone.
        Assert.Single(await db.OrganizationMembers.Where(member => member.UserId == organizerWithArchivedMembershipOnlyId).ToListAsync());
        var organization = await db.Organizations.SingleAsync(item => item.Id == archivedOrganizationId);
        Assert.NotNull(organization.DeletedAt);
    }

    [Fact]
    public async Task Admins_are_never_demoted()
    {
        await using var db = CreateContext();
        var withoutMembership = await db.Users.SingleAsync(item => item.Id == adminWithoutMembershipId);
        var withMembership = await db.Users.SingleAsync(item => item.Id == adminWithMembershipId);
        var withArchivedMembershipOnly = await db.Users.SingleAsync(item => item.Id == adminWithArchivedMembershipOnlyId);
        Assert.Equal(GlobalRoles.Admin, withoutMembership.GlobalRole);
        Assert.Equal(GlobalRoles.Admin, withMembership.GlobalRole);
        Assert.Equal(GlobalRoles.Admin, withArchivedMembershipOnly.GlobalRole);
        Assert.Equal(SeededSecurityStamp, withoutMembership.SecurityStamp);
        Assert.Equal(SeededSecurityStamp, withArchivedMembershipOnly.SecurityStamp);
    }

    /// <summary>
    /// ADR 0041 removed <c>Owner</c> from the domain, so the only way a row can still read it is a
    /// database written before that - which is exactly what <c>RemoveOrganizationOwnership</c> heals.
    /// The row is seeded through raw SQL because <c>OrganizationMember.Create</c> refuses the role.
    /// </summary>
    [Fact]
    public async Task Stored_owner_rows_are_rewritten_to_organizer()
    {
        await using var db = CreateContext();
        var member = await db.OrganizationMembers.SingleAsync(item =>
            item.OrganizationId == staffedOrganizationId && item.UserId == organizerWithMembershipId);
        Assert.Equal(OrganizationRoles.Organizer, member.Role);
        Assert.Empty(await db.OrganizationMembers.Where(item => item.Role == "Owner").ToListAsync());
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

        Assert.Equal(2, demoted.Count);
        Assert.All(demoted, record =>
        {
            Assert.Equal("user", record.EntityType);
            Assert.Null(record.ActorId);
        });

        var withoutMembership = Assert.Single(demoted, record => record.EntityId == organizerWithoutMembershipId.ToString("D"));
        Assert.Contains("\"no_membership\"", withoutMembership.RedactedDiff, StringComparison.Ordinal);

        var archivedOnly = Assert.Single(demoted, record => record.EntityId == organizerWithArchivedMembershipOnlyId.ToString("D"));
        Assert.Contains("\"no_live_membership\"", archivedOnly.RedactedDiff, StringComparison.Ordinal);
    }

    /// <summary>
    /// A second <c>MigrateAsync()</c> proves EF bookkeeping only - <c>__EFMigrationsHistory</c> makes
    /// it a no-op before a single statement runs. The statements themselves are therefore replayed
    /// straight against the connection, which is what "the SQL is idempotent" actually claims.
    /// </summary>
    [Fact]
    public async Task Re_running_the_heal_changes_nothing()
    {
        await using var db = CreateContext();
        var before = await SnapshotAsync(db);

        await db.Database.MigrateAsync();
        var replayed = await ReplayHealStatementsAsync(db);
        Assert.True(replayed >= 5, $"expected the heal statements to be replayed, ran {replayed}");

        await using var reread = CreateContext();
        Assert.Equal(before, await SnapshotAsync(reread));
    }

    /// <summary>Runs both heals' <c>Up</c> statements again, verbatim, and returns how many ran.</summary>
    private static async Task<int> ReplayHealStatementsAsync(GonesDbContext db)
    {
        Migration[] heals = [new HealOrganizationMembershipInvariants(), new HealOrganizerRolesWithoutLiveMembership()];
        var statements = heals
            .SelectMany(heal => heal.UpOperations)
            .OfType<SqlOperation>()
            .Select(operation => operation.Sql)
            .ToList();

        // Sent straight down the connection: the statements carry JSON literals, and the EF raw-SQL
        // helpers would read their braces as format placeholders. LOCK TABLE is only legal inside a
        // transaction block, which is how EF runs a migration too.
        var connection = db.Database.GetDbConnection();
        await using var transaction = await db.Database.BeginTransactionAsync();
        foreach (var statement in statements)
        {
            await using var command = connection.CreateCommand();
            command.CommandText = statement;
            command.Transaction = transaction.GetDbTransaction();
            await command.ExecuteNonQueryAsync();
        }

        await transaction.CommitAsync();
        return statements.Count;
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
        // Already archived when the heal runs: its members hold no live membership, which is what the
        // first heal's "no membership row at all" predicate walked past.
        var archivedOrganization = Organization.Create($"Archived {Guid.NewGuid():N}", null, null, null, Now);
        archivedOrganization.SoftDelete(Now);
        var organizerWithoutMembership = NewUser(GlobalRoles.Organizer);
        var organizerWithArchivedMembershipOnly = NewUser(GlobalRoles.Organizer);
        var adminWithArchivedMembershipOnly = NewUser(GlobalRoles.Admin);
        var organizerWithMembership = NewUser(GlobalRoles.Organizer);
        var adminWithoutMembership = NewUser(GlobalRoles.Admin);
        var adminWithMembership = NewUser(GlobalRoles.Admin);
        var memberWithUserRole = NewUser(GlobalRoles.User);

        db.Organizations.AddRange(emptyOrganization, staffedOrganization, archivedOrganization);
        db.Users.AddRange(
            organizerWithoutMembership,
            organizerWithArchivedMembershipOnly,
            adminWithArchivedMembershipOnly,
            organizerWithMembership,
            adminWithoutMembership,
            adminWithMembership,
            memberWithUserRole);
        await db.SaveChangesAsync();

        db.OrganizationMembers.AddRange(
            OrganizationMember.Create(staffedOrganization.Id, organizerWithMembership.Id, OrganizationRoles.Organizer, Now),
            OrganizationMember.Create(staffedOrganization.Id, adminWithMembership.Id, OrganizationRoles.Organizer, Now),
            OrganizationMember.Create(staffedOrganization.Id, memberWithUserRole.Id, OrganizationRoles.Organizer, Now),
            OrganizationMember.Create(archivedOrganization.Id, organizerWithArchivedMembershipOnly.Id, OrganizationRoles.Organizer, Now),
            OrganizationMember.Create(archivedOrganization.Id, adminWithArchivedMembershipOnly.Id, OrganizationRoles.Organizer, Now));
        await db.SaveChangesAsync();

        // Pre-ADR-0041 rows: the domain refuses to build them, and the schema at this revision still
        // accepts them, so they go in as raw SQL - one per organization, as the owner index demanded.
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            UPDATE organization_members SET role = 'Owner'
            WHERE (organization_id = {staffedOrganization.Id} AND user_id = {organizerWithMembership.Id})
               OR (organization_id = {archivedOrganization.Id} AND user_id = {organizerWithArchivedMembershipOnly.Id})
            """);
        db.ChangeTracker.Clear();

        emptyOrganizationId = emptyOrganization.Id;
        staffedOrganizationId = staffedOrganization.Id;
        archivedOrganizationId = archivedOrganization.Id;
        organizerWithoutMembershipId = organizerWithoutMembership.Id;
        organizerWithArchivedMembershipOnlyId = organizerWithArchivedMembershipOnly.Id;
        adminWithArchivedMembershipOnlyId = adminWithArchivedMembershipOnly.Id;
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
