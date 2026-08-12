using System.Security.Claims;
using System.Text.Json;
using Gones.Api.Errors;
using Gones.Domain.Identity;
using Gones.Domain.Organizations;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Organizations;

internal sealed class OrganizationService(
    GonesDbContext database,
    OrganizationAccessService access,
    OrganizationMembershipRoleService membershipRoles,
    IEnumerable<IOrganizationDeleteDependency> deleteDependencies,
    IClock clock)
{
    public async Task<Organization> CreateAsync(
        Guid actorUserId,
        string name,
        string? description,
        string? website,
        string? contactEmail,
        Guid ownerUserId,
        CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        Organization organization;
        try
        {
            organization = Organization.Create(name, description, website, contactEmail, now);
        }
        catch (ArgumentException exception)
        {
            throw Validation(exception);
        }

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var owner = await database.Users
            .FromSqlInterpolated($"SELECT * FROM asp_net_users WHERE id = {ownerUserId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw Validation("ownerUserId", "Owner user was not found.");

        if (!owner.EmailConfirmed)
        {
            throw Validation("ownerUserId", "Owner user must have a verified email.");
        }

        if (await database.Organizations.AnyAsync(item => item.NormalizedName == organization.NormalizedName, cancellationToken))
        {
            throw new ResourceConflictException();
        }

        var ownerMember = OrganizationMember.Create(organization.Id, owner.Id, OrganizationRoles.Owner, now);
        var settings = OrganizationNotificationSettings.CreateDefault(organization.Id, now);
        database.Organizations.Add(organization);
        database.OrganizationMembers.Add(ownerMember);
        database.OrganizationNotificationSettings.Add(settings);
        database.AuditRecords.Add(NewAudit(actorUserId, "admin.organization.created", "organization", organization.Id,
            JsonSerializer.Serialize(new
            {
                fields = new[] { "name", "description", "website", "contactEmail", "ownerUserId" },
                name = organization.Name,
                ownerUserId = owner.Id
            }), now));

        try
        {
            await database.SaveChangesAsync(cancellationToken);
            // The owner membership is a membership like any other: creating the organization is what
            // makes its owner an Organizer.
            await membershipRoles.SyncAfterMembershipChangeAsync(actorUserId, owner.Id, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return organization;
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ResourceConflictException();
        }
    }

    public async Task<Organization> UpdateAsync(
        Guid actorUserId,
        Guid organizationId,
        string name,
        string? description,
        string? website,
        string? contactEmail,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var organization = await LockOrganizationAsync(organizationId, cancellationToken)
            ?? throw new ResourceNotFoundException();

        var previousNormalized = organization.NormalizedName;
        try
        {
            organization.Update(name, description, website, contactEmail, clock.GetCurrentInstant());
        }
        catch (ArgumentException exception)
        {
            throw Validation(exception);
        }
        catch (InvalidOperationException)
        {
            throw new ResourceConflictException();
        }

        if (!string.Equals(previousNormalized, organization.NormalizedName, StringComparison.Ordinal)
            && await database.Organizations.AnyAsync(
                item => item.Id != organization.Id && item.NormalizedName == organization.NormalizedName,
                cancellationToken))
        {
            throw new ResourceConflictException();
        }

        database.AuditRecords.Add(NewAudit(actorUserId, "admin.organization.updated", "organization", organization.Id,
            JsonSerializer.Serialize(new { fields = new[] { "name", "description", "website", "contactEmail" }, name = organization.Name }),
            clock.GetCurrentInstant()));
        try
        {
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return organization;
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ResourceConflictException();
        }
    }

    public async Task SoftDeleteAsync(Guid actorUserId, Guid organizationId, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var organization = await LockOrganizationAsync(organizationId, cancellationToken)
            ?? throw new ResourceNotFoundException();

        if (organization.DeletedAt is not null)
        {
            throw new ResourceNotFoundException();
        }

        var blockers = new List<string>();
        foreach (var dependency in deleteDependencies)
        {
            blockers.AddRange(await dependency.GetBlockersAsync(organizationId, cancellationToken));
        }

        if (blockers.Count > 0)
        {
            throw new ResourceConflictException();
        }

        // The derivation counts memberships in live organizations only, so archiving one is a
        // membership change for everyone in it: their last live membership can disappear here.
        var memberUserIds = await LockMemberUserIdsAsync(organizationId, cancellationToken);

        organization.SoftDelete(clock.GetCurrentInstant());
        database.AuditRecords.Add(NewAudit(actorUserId, "admin.organization.deleted", "organization", organization.Id,
            JsonSerializer.Serialize(new { fields = new[] { "deletedAt" }, name = organization.Name }),
            clock.GetCurrentInstant()));
        await database.SaveChangesAsync(cancellationToken);
        await membershipRoles.SyncAfterMembershipChangeAsync(actorUserId, memberUserIds, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task RestoreAsync(Guid actorUserId, Guid organizationId, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var organization = await LockOrganizationAsync(organizationId, cancellationToken)
            ?? throw new ResourceNotFoundException();

        if (organization.DeletedAt is null)
        {
            throw new ResourceConflictException();
        }

        if (await database.Organizations.AnyAsync(
                item => item.Id != organization.Id
                    && item.DeletedAt == null
                    && item.NormalizedName == organization.NormalizedName,
                cancellationToken))
        {
            throw new ResourceConflictException();
        }

        // Mirror of the archive: the memberships become live again, so the roles they imply have to
        // catch up in the same transaction.
        var memberUserIds = await LockMemberUserIdsAsync(organizationId, cancellationToken);

        organization.Restore(clock.GetCurrentInstant());
        database.AuditRecords.Add(NewAudit(actorUserId, "admin.organization.restored", "organization", organization.Id,
            JsonSerializer.Serialize(new { fields = new[] { "deletedAt" }, name = organization.Name }),
            clock.GetCurrentInstant()));
        await database.SaveChangesAsync(cancellationToken);
        await membershipRoles.SyncAfterMembershipChangeAsync(actorUserId, memberUserIds, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<OrganizationMember> AddMemberAsync(
        Guid actorUserId,
        Guid organizationId,
        Guid memberUserId,
        string role,
        bool actorIsAdmin,
        CancellationToken cancellationToken)
    {
        // Defence in depth behind the Admin policy on the route: creating a membership grants the
        // global Organizer role, so it never runs for a non-admin actor whatever calls this.
        if (!actorIsAdmin) throw new AdminMembershipGrantRequiredException();
        if (!OrganizationRoles.IsKnown(role)) throw Validation("role", "Role must be Owner or Organizer.");
        if (role == OrganizationRoles.Owner)
        {
            throw Validation("role", "Owner can only be assigned at creation or via ownership transfer.");
        }

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        _ = await access.RequireOwnerAsync(organizationId, actorUserId, actorIsAdmin, cancellationToken);
        var organization = await LockOrganizationAsync(organizationId, cancellationToken)
            ?? throw new ResourceNotFoundException();
        if (!organization.IsActive) throw new ResourceNotFoundException();

        var user = await database.Users.SingleOrDefaultAsync(item => item.Id == memberUserId, cancellationToken)
            ?? throw Validation("userId", "User was not found.");
        if (!user.EmailConfirmed) throw Validation("userId", "User must have a verified email.");

        if (await database.OrganizationMembers.AnyAsync(
                item => item.OrganizationId == organizationId && item.UserId == memberUserId,
                cancellationToken))
        {
            throw new ResourceConflictException();
        }

        var now = clock.GetCurrentInstant();
        var member = OrganizationMember.Create(organizationId, memberUserId, role, now);
        database.OrganizationMembers.Add(member);
        database.AuditRecords.Add(NewAudit(actorUserId, "organization.member.added", "organization_member", member.Id,
            JsonSerializer.Serialize(new
            {
                organizationId,
                userId = memberUserId,
                role,
                fields = new[] { "userId", "role" }
            }), now));
        try
        {
            await database.SaveChangesAsync(cancellationToken);
            await membershipRoles.SyncAfterMembershipChangeAsync(actorUserId, memberUserId, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return member;
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ResourceConflictException();
        }
    }

    public async Task RemoveMemberAsync(
        Guid actorUserId,
        Guid organizationId,
        Guid memberUserId,
        bool actorIsAdmin,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        _ = await access.RequireOwnerAsync(organizationId, actorUserId, actorIsAdmin, cancellationToken);
        var organization = await LockOrganizationAsync(organizationId, cancellationToken)
            ?? throw new ResourceNotFoundException();
        if (!organization.IsActive) throw new ResourceNotFoundException();

        var member = await database.OrganizationMembers
            .FromSqlInterpolated($"""
                SELECT * FROM organization_members
                WHERE organization_id = {organizationId} AND user_id = {memberUserId}
                FOR UPDATE
                """)
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ResourceNotFoundException();

        var ownerCount = await database.OrganizationMembers.CountAsync(
            item => item.OrganizationId == organizationId && item.Role == OrganizationRoles.Owner,
            cancellationToken);
        var memberCount = await database.OrganizationMembers.CountAsync(
            item => item.OrganizationId == organizationId,
            cancellationToken);
        try
        {
            OrganizationMembershipPolicy.EnsureCanRemove(member, ownerCount, memberCount);
        }
        catch (InvalidOperationException)
        {
            throw new ResourceConflictException();
        }

        database.OrganizationMembers.Remove(member);
        database.AuditRecords.Add(NewAudit(actorUserId, "organization.member.removed", "organization_member", member.Id,
            JsonSerializer.Serialize(new
            {
                organizationId,
                userId = memberUserId,
                role = member.Role,
                fields = new[] { "removed" }
            }), clock.GetCurrentInstant()));
        await database.SaveChangesAsync(cancellationToken);
        await membershipRoles.SyncAfterMembershipChangeAsync(actorUserId, memberUserId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task ChangeMemberRoleAsync(
        Guid actorUserId,
        Guid organizationId,
        Guid memberUserId,
        string role,
        bool actorIsAdmin,
        CancellationToken cancellationToken)
    {
        if (!OrganizationRoles.IsKnown(role)) throw Validation("role", "Role must be Owner or Organizer.");
        if (role == OrganizationRoles.Owner)
        {
            throw Validation("role", "Use ownership transfer to assign Owner.");
        }

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        _ = await access.RequireOwnerAsync(organizationId, actorUserId, actorIsAdmin, cancellationToken);
        var organization = await LockOrganizationAsync(organizationId, cancellationToken)
            ?? throw new ResourceNotFoundException();
        if (!organization.IsActive) throw new ResourceNotFoundException();

        var member = await database.OrganizationMembers
            .FromSqlInterpolated($"""
                SELECT * FROM organization_members
                WHERE organization_id = {organizationId} AND user_id = {memberUserId}
                FOR UPDATE
                """)
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ResourceNotFoundException();

        var ownerCount = await database.OrganizationMembers.CountAsync(
            item => item.OrganizationId == organizationId && item.Role == OrganizationRoles.Owner,
            cancellationToken);
        try
        {
            OrganizationMembershipPolicy.EnsureCanDemote(member, role, ownerCount);
            member.ChangeRole(role, clock.GetCurrentInstant());
        }
        catch (InvalidOperationException)
        {
            throw new ResourceConflictException();
        }
        catch (ArgumentException exception)
        {
            throw Validation(exception);
        }

        database.AuditRecords.Add(NewAudit(actorUserId, "organization.member.role_changed", "organization_member", member.Id,
            JsonSerializer.Serialize(new
            {
                organizationId,
                userId = memberUserId,
                role,
                fields = new[] { "role" }
            }), clock.GetCurrentInstant()));
        try
        {
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ResourceConflictException();
        }
    }

    public async Task TransferOwnershipAsync(
        Guid actorUserId,
        Guid organizationId,
        Guid newOwnerUserId,
        bool actorIsAdmin,
        CancellationToken cancellationToken)
    {
        // Same reason as AddMemberAsync: a transfer to a non-member mints a membership.
        if (!actorIsAdmin) throw new AdminMembershipGrantRequiredException();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        _ = await access.RequireOwnerAsync(organizationId, actorUserId, actorIsAdmin, cancellationToken);
        var organization = await LockOrganizationAsync(organizationId, cancellationToken)
            ?? throw new ResourceNotFoundException();
        if (!organization.IsActive) throw new ResourceNotFoundException();

        var members = await database.OrganizationMembers
            .FromSqlInterpolated($"""
                SELECT * FROM organization_members
                WHERE organization_id = {organizationId}
                FOR UPDATE
                """)
            .ToListAsync(cancellationToken);

        var currentOwner = members.SingleOrDefault(item => item.Role == OrganizationRoles.Owner)
            ?? throw new ResourceConflictException();
        if (currentOwner.UserId == newOwnerUserId)
        {
            await transaction.CommitAsync(cancellationToken);
            return;
        }

        var newOwnerUser = await database.Users.SingleOrDefaultAsync(item => item.Id == newOwnerUserId, cancellationToken)
            ?? throw Validation("newOwnerUserId", "User was not found.");
        if (!newOwnerUser.EmailConfirmed) throw Validation("newOwnerUserId", "User must have a verified email.");

        var now = clock.GetCurrentInstant();
        // Demote then promote in separate flushes so partial unique owner index never sees two Owners.
        var previousOwnerUserId = currentOwner.UserId;
        currentOwner.ChangeRole(OrganizationRoles.Organizer, now);
        try
        {
            await database.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ResourceConflictException();
        }

        var incoming = members.SingleOrDefault(item => item.UserId == newOwnerUserId);
        if (incoming is null)
        {
            incoming = OrganizationMember.Create(organizationId, newOwnerUserId, OrganizationRoles.Owner, now);
            database.OrganizationMembers.Add(incoming);
        }
        else
        {
            incoming.ChangeRole(OrganizationRoles.Owner, now);
        }

        database.AuditRecords.Add(NewAudit(actorUserId, "organization.owner.transferred", "organization", organizationId,
            JsonSerializer.Serialize(new
            {
                previousOwnerUserId,
                newOwnerUserId,
                fields = new[] { "owner" }
            }), now));

        try
        {
            await database.SaveChangesAsync(cancellationToken);
            // A transfer can hand the organization to someone who was not a member yet, so both sides
            // are re-derived; the outgoing owner keeps a membership and normally does not move.
            await membershipRoles.SyncAfterMembershipChangeAsync(
                actorUserId,
                [previousOwnerUserId, newOwnerUserId],
                cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ResourceConflictException();
        }
    }

    public async Task<OrganizationNotificationSettings> UpdateNotificationSettingsAsync(
        Guid actorUserId,
        Guid organizationId,
        bool notifyOnRegistration,
        bool notifyOnUnregistration,
        bool actorIsAdmin,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        _ = await access.RequireOwnerAsync(organizationId, actorUserId, actorIsAdmin, cancellationToken);
        var organization = await LockOrganizationAsync(organizationId, cancellationToken)
            ?? throw new ResourceNotFoundException();
        if (!organization.IsActive) throw new ResourceNotFoundException();

        var settings = await database.OrganizationNotificationSettings
            .FromSqlInterpolated($"""
                SELECT * FROM organization_notification_settings
                WHERE organization_id = {organizationId}
                FOR UPDATE
                """)
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ResourceNotFoundException();

        settings.Update(notifyOnRegistration, notifyOnUnregistration, clock.GetCurrentInstant());
        database.AuditRecords.Add(NewAudit(actorUserId, "organization.notification_settings.updated", "organization_notification_settings", settings.Id,
            JsonSerializer.Serialize(new
            {
                organizationId,
                notifyOnRegistration,
                notifyOnUnregistration,
                fields = new[] { "notifyOnRegistration", "notifyOnUnregistration" }
            }), clock.GetCurrentInstant()));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return settings;
    }

    /// <summary>
    /// Locks the organization's membership rows and returns their user ids. Taken between the
    /// organization lock and the user locks the sync then takes, which is the global lock order.
    /// </summary>
    private async Task<IReadOnlyList<Guid>> LockMemberUserIdsAsync(Guid organizationId, CancellationToken cancellationToken)
    {
        var members = await database.OrganizationMembers
            .FromSqlInterpolated($"""
                SELECT * FROM organization_members
                WHERE organization_id = {organizationId}
                FOR UPDATE
                """)
            .ToListAsync(cancellationToken);
        return members.Select(member => member.UserId).ToList();
    }

    private async Task<Organization?> LockOrganizationAsync(Guid organizationId, CancellationToken cancellationToken) =>
        await database.Organizations
            .FromSqlInterpolated($"SELECT * FROM organizations WHERE id = {organizationId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);

    private static ApiValidationException Validation(ArgumentException exception) =>
        new(new Dictionary<string, string[]> { [exception.ParamName ?? "request"] = [exception.Message] });

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });

    private static AuditRecord NewAudit(Guid actorId, string action, string entityType, Guid entityId, string diff, Instant now) => new()
    {
        ActorId = actorId,
        Action = action,
        EntityType = entityType,
        EntityId = entityId.ToString("D"),
        RedactedDiff = diff,
        OccurredAt = now
    };
}

internal static class OrganizationPrincipal
{
    public static Guid UserId(ClaimsPrincipal principal)
    {
        var value = principal.FindFirstValue("sub") ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(value, out var userId) ? userId : throw new AuthenticationFailedException();
    }

    public static bool IsAdmin(ClaimsPrincipal principal) =>
        principal.IsInRole(GlobalRoles.Admin)
        || principal.Claims.Any(claim =>
            (claim.Type is "role" or ClaimTypes.Role)
            && string.Equals(claim.Value, GlobalRoles.Admin, StringComparison.Ordinal));
}
