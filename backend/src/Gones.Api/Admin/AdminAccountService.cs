using System.Text.Json;
using Gones.Api.Errors;
using Gones.Api.Identity;
using Gones.Api.Organizations;
using Gones.Domain.Identity;
using Gones.Domain.Organizations;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Admin;

internal sealed class AdminAccountService(
    GonesDbContext database,
    UserManager<ApplicationUser> userManager,
    RefreshSessionService sessionService,
    OrganizationMembershipRoleService membershipRoles,
    IClock clock)
{
    public async Task<AccountClosureImpact> GetClosureImpactAsync(
        Guid actorUserId,
        Guid subjectUserId,
        CancellationToken cancellationToken)
    {
        var subject = await database.Users.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == subjectUserId, cancellationToken)
            ?? throw new ResourceNotFoundException();
        var profile = await database.UserProfiles.AsNoTracking()
            .SingleOrDefaultAsync(item => item.UserId == subjectUserId, cancellationToken)
            ?? throw new ResourceNotFoundException();

        var soleOwned = await LoadSoleOwnedAsync(subjectUserId, cancellationToken);
        var soleOwnedIds = soleOwned.Select(org => org.OrganizationId).ToArray();
        var otherMemberships = await database.OrganizationMembers.AsNoTracking()
            .Where(item => item.UserId == subjectUserId && !soleOwnedIds.Contains(item.OrganizationId))
            .Select(item => item.OrganizationId)
            .ToListAsync(cancellationToken);

        var adminCount = await database.Users.CountAsync(user => user.GlobalRole == GlobalRoles.Admin, cancellationToken);
        var hardBlock = AccountClosurePolicy.EvaluateBlock(
            actorUserId,
            subjectUserId,
            subject.GlobalRole,
            profile.IsClosed,
            adminCount,
            Array.Empty<Guid>(),
            new HashSet<Guid>());
        var needsTransfers = soleOwned.Count > 0;

        return new AccountClosureImpact(
            subjectUserId,
            profile.Username,
            subject.Email ?? string.Empty,
            subject.GlobalRole,
            profile.IsClosed,
            subject.GlobalRole == GlobalRoles.Admin && adminCount <= 1,
            actorUserId == subjectUserId,
            hardBlock is null,
            hardBlock ?? (needsTransfers ? "missing_owner_transfer" : null),
            soleOwned,
            otherMemberships);
    }

    public async Task CloseAsync(
        Guid actorUserId,
        Guid subjectUserId,
        string confirmedUsername,
        IReadOnlyList<OwnershipTransferRequest> ownershipTransfers,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var now = clock.GetCurrentInstant();

        // Lock order (see OrganizationMembershipRoleService): organizations -> organization_members
        // -> asp_net_users. The pre-checks therefore read the subject unlocked, the organization work
        // below takes its locks first, and every check that guards the write is re-run once the user
        // rows are actually held.
        var preview = await database.Users.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == subjectUserId, cancellationToken)
            ?? throw new ResourceNotFoundException();
        var previewProfile = await database.UserProfiles.AsNoTracking()
            .SingleOrDefaultAsync(item => item.UserId == subjectUserId, cancellationToken)
            ?? throw new ResourceNotFoundException();

        if (!string.Equals(previewProfile.Username, confirmedUsername.Trim(), StringComparison.Ordinal))
        {
            throw Validation("confirmedUsername", "Typed username does not match the target account.");
        }

        var soleOwned = await LoadSoleOwnedAsync(subjectUserId, cancellationToken);
        var transferMap = ownershipTransfers
            .GroupBy(item => item.OrganizationId)
            .ToDictionary(group => group.Key, group => group.Last().NewOwnerUserId);
        if (transferMap.Count != ownershipTransfers.Count)
        {
            throw Validation("ownershipTransfers", "Duplicate organization transfers are not allowed.");
        }

        await EnsureNotBlockedAsync(
            actorUserId, subjectUserId, preview.GlobalRole, previewProfile.IsClosed, soleOwned, transferMap, cancellationToken);

        // Ascending organization id, so two closures sharing organizations queue up instead of
        // deadlocking on each other.
        foreach (var org in soleOwned.OrderBy(item => item.OrganizationId))
        {
            if (!transferMap.TryGetValue(org.OrganizationId, out var newOwnerUserId))
            {
                throw Validation("ownershipTransfers", "Every solely owned organization requires a new Owner.");
            }

            if (newOwnerUserId == subjectUserId)
            {
                throw Validation("ownershipTransfers", "New Owner cannot be the closed account.");
            }

            await TransferSoleOwnershipAsync(org.OrganizationId, subjectUserId, newOwnerUserId, actorUserId, now, cancellationToken);
        }

        var memberships = await database.OrganizationMembers
            .FromSqlInterpolated($"""
                SELECT * FROM organization_members
                WHERE user_id = {subjectUserId}
                FOR UPDATE
                """)
            .ToListAsync(cancellationToken);
        database.OrganizationMembers.RemoveRange(memberships);

        // Every user row this closure writes, locked in one ascending-id pass: the subject plus the
        // incoming owners the membership sync below promotes.
        ApplicationUser? locked = null;
        foreach (var userId in transferMap.Values.Append(subjectUserId).Distinct().OrderBy(item => item))
        {
            var user = await database.Users
                .FromSqlInterpolated($"SELECT * FROM asp_net_users WHERE id = {userId} FOR UPDATE")
                .SingleOrDefaultAsync(cancellationToken);
            if (userId == subjectUserId) locked = user;
        }

        var subject = locked ?? throw new ResourceNotFoundException();
        var profile = await database.UserProfiles
            .FromSqlInterpolated($"SELECT * FROM user_profiles WHERE user_id = {subjectUserId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ResourceNotFoundException();

        // Re-run under the row locks: the organization work above ran with the subject unlocked, so a
        // concurrent closure or role change may have moved the ground in the meantime.
        await EnsureNotBlockedAsync(
            actorUserId, subjectUserId, subject.GlobalRole, profile.IsClosed, soleOwned, transferMap, cancellationToken);

        var identities = await database.ExternalIdentities
            .FromSqlInterpolated($"SELECT * FROM external_identities WHERE user_id = {subjectUserId} FOR UPDATE")
            .ToListAsync(cancellationToken);
        var removedProviders = identities.Select(item => item.Provider).Distinct().OrderBy(item => item).ToArray();
        database.ExternalIdentities.RemoveRange(identities);

        var opaqueUsername = AccountClosureIdentity.OpaqueUsername(subjectUserId);
        var opaqueEmail = AccountClosureIdentity.OpaqueEmail(subjectUserId);
        profile.CloseAndAnonymize(opaqueUsername, now);

        subject.Email = opaqueEmail;
        subject.NormalizedEmail = opaqueEmail.ToUpperInvariant();
        subject.UserName = opaqueUsername;
        subject.NormalizedUserName = opaqueUsername.ToUpperInvariant();
        subject.EmailConfirmed = false;
        subject.PhoneNumber = null;
        subject.PhoneNumberConfirmed = false;
        subject.TwoFactorEnabled = false;
        subject.LockoutEnabled = true;
        subject.LockoutEnd = DateTimeOffset.MaxValue;
        subject.AccessFailedCount = 0;
        subject.SecurityStamp = Guid.NewGuid().ToString("N");
        subject.PasswordHash = userManager.PasswordHasher.HashPassword(subject, Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N"));
        if (subject.GlobalRole != GlobalRoles.User)
        {
            subject.AssignGlobalRole(GlobalRoles.User);
        }

        await sessionService.RevokeAllForAccountClosureAsync(subjectUserId, cancellationToken);

        database.AuditRecords.Add(NewAudit(actorUserId, "admin.user.closed", "user", subjectUserId,
            JsonSerializer.Serialize(new
            {
                fields = new[]
                {
                    "email", "username", "firstName", "lastName", "locationCountry", "locationRegion", "locationCity", "birthDate",
                    "globalRole", "securityStamp", "password", "sessions", "externalIdentities", "memberships"
                },
                soleOwnedOrganizationIds = soleOwned.Select(item => item.OrganizationId).ToArray(),
                ownershipTransfers = transferMap.Select(pair => new { organizationId = pair.Key, newOwnerUserId = pair.Value }).ToArray(),
                removedProviders,
                removedMembershipCount = memberships.Count
            }), now));

        try
        {
            // The subject is demoted above by closure itself; the accounts that inherited an
            // organization are the ones whose derived role has to catch up with their new
            // membership. It saves, so it belongs inside the catch: a concurrent write has to leave
            // as the mapped conflict, not as an unhandled 500.
            await membershipRoles.SyncAfterMembershipChangeAsync(actorUserId, transferMap.Values, cancellationToken);
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ResourceConflictException();
        }
    }

    private async Task TransferSoleOwnershipAsync(
        Guid organizationId,
        Guid previousOwnerUserId,
        Guid newOwnerUserId,
        Guid actorUserId,
        Instant now,
        CancellationToken cancellationToken)
    {
        var organization = await database.Organizations
            .FromSqlInterpolated($"SELECT * FROM organizations WHERE id = {organizationId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw Validation("ownershipTransfers", "Organization was not found.");
        if (!organization.IsActive) throw Validation("ownershipTransfers", "Organization is deleted.");

        var members = await database.OrganizationMembers
            .FromSqlInterpolated($"""
                SELECT * FROM organization_members
                WHERE organization_id = {organizationId}
                FOR UPDATE
                """)
            .ToListAsync(cancellationToken);

        var currentOwner = members.SingleOrDefault(item => item.Role == OrganizationRoles.Owner)
            ?? throw new ResourceConflictException();
        if (currentOwner.UserId != previousOwnerUserId)
        {
            throw new ResourceConflictException();
        }

        var newOwnerUser = await database.Users.SingleOrDefaultAsync(item => item.Id == newOwnerUserId, cancellationToken)
            ?? throw Validation("ownershipTransfers", "New Owner user was not found.");
        if (!newOwnerUser.EmailConfirmed)
        {
            throw Validation("ownershipTransfers", "New Owner must have a verified email.");
        }

        var newOwnerProfile = await database.UserProfiles.AsNoTracking()
            .SingleOrDefaultAsync(item => item.UserId == newOwnerUserId, cancellationToken)
            ?? throw Validation("ownershipTransfers", "New Owner profile was not found.");
        if (newOwnerProfile.IsClosed)
        {
            throw Validation("ownershipTransfers", "New Owner account is closed.");
        }

        currentOwner.ChangeRole(OrganizationRoles.Organizer, now);
        try
        {
            await database.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
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
                fields = new[] { "owner" },
                reason = "account_closure"
            }), now));
        await database.SaveChangesAsync(cancellationToken);
    }

    private async Task EnsureNotBlockedAsync(
        Guid actorUserId,
        Guid subjectUserId,
        string globalRole,
        bool isClosed,
        IReadOnlyList<SoleOwnerOrganizationImpact> soleOwned,
        IReadOnlyDictionary<Guid, Guid> transferMap,
        CancellationToken cancellationToken)
    {
        var adminCount = await database.Users.CountAsync(user => user.GlobalRole == GlobalRoles.Admin, cancellationToken);
        var block = AccountClosurePolicy.EvaluateBlock(
            actorUserId,
            subjectUserId,
            globalRole,
            isClosed,
            adminCount,
            soleOwned.Select(item => item.OrganizationId).ToArray(),
            transferMap.Keys.ToHashSet());
        if (block is null) return;

        throw block switch
        {
            "already_closed" => new ResourceConflictException(),
            "self_close" => new ResourceConflictException(),
            "last_admin" => new ResourceConflictException(),
            "missing_owner_transfer" => Validation("ownershipTransfers", "Every solely owned organization requires a new Owner."),
            _ => new ResourceConflictException()
        };
    }

    private async Task<IReadOnlyList<SoleOwnerOrganizationImpact>> LoadSoleOwnedAsync(
        Guid subjectUserId,
        CancellationToken cancellationToken)
    {
        var owned = await (
            from member in database.OrganizationMembers.AsNoTracking()
            join organization in database.Organizations.AsNoTracking() on member.OrganizationId equals organization.Id
            where member.UserId == subjectUserId
                && member.Role == OrganizationRoles.Owner
                && organization.DeletedAt == null
            select new { organization.Id, organization.Name }
        ).ToListAsync(cancellationToken);

        var results = new List<SoleOwnerOrganizationImpact>();
        foreach (var org in owned)
        {
            var ownerCount = await database.OrganizationMembers.AsNoTracking()
                .CountAsync(item => item.OrganizationId == org.Id && item.Role == OrganizationRoles.Owner, cancellationToken);
            if (ownerCount != 1) continue;

            var suggestion = await (
                from member in database.OrganizationMembers.AsNoTracking()
                join profile in database.UserProfiles.AsNoTracking() on member.UserId equals profile.UserId
                where member.OrganizationId == org.Id
                    && member.UserId != subjectUserId
                    && profile.ClosedAt == null
                orderby member.Role == OrganizationRoles.Organizer ? 0 : 1, profile.NormalizedUsername
                select new { member.UserId, profile.Username }
            ).FirstOrDefaultAsync(cancellationToken);

            results.Add(new SoleOwnerOrganizationImpact(
                org.Id,
                org.Name,
                suggestion?.UserId,
                suggestion?.Username));
        }

        return results;
    }

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

internal sealed record OwnershipTransferRequest(Guid OrganizationId, Guid NewOwnerUserId);
