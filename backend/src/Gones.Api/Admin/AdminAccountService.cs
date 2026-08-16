using System.Text.Json;
using Gones.Api.Errors;
using Gones.Api.Identity;
using Gones.Domain.Identity;
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

        var memberships = await database.OrganizationMembers.AsNoTracking()
            .Where(item => item.UserId == subjectUserId)
            .Select(item => item.OrganizationId)
            .ToListAsync(cancellationToken);

        var adminCount = await database.Users.CountAsync(user => user.GlobalRole == GlobalRoles.Admin, cancellationToken);
        var hardBlock = AccountClosurePolicy.EvaluateBlock(
            actorUserId,
            subjectUserId,
            subject.GlobalRole,
            profile.IsClosed,
            adminCount);

        return new AccountClosureImpact(
            subjectUserId,
            profile.Username,
            subject.Email ?? string.Empty,
            subject.GlobalRole,
            profile.IsClosed,
            subject.GlobalRole == GlobalRoles.Admin && adminCount <= 1,
            actorUserId == subjectUserId,
            hardBlock is null,
            hardBlock,
            memberships);
    }

    public async Task CloseAsync(
        Guid actorUserId,
        Guid subjectUserId,
        string confirmedUsername,
        CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var now = clock.GetCurrentInstant();

        // Lock order (see OrganizationMembershipRoleService): organizations -> organization_members
        // -> asp_net_users. The pre-checks therefore read the subject unlocked, the membership rows
        // below take their locks first, and every check that guards the write is re-run once the user
        // row is actually held.
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

        await EnsureNotBlockedAsync(
            actorUserId, subjectUserId, preview.GlobalRole, previewProfile.IsClosed, cancellationToken);

        // Nobody owns an organization (ADR 0041), so the closure just drops the memberships. One left
        // with no members at all is Draft, which ADR 0034 already models and enforces.
        var memberships = await database.OrganizationMembers
            .FromSqlInterpolated($"""
                SELECT * FROM organization_members
                WHERE user_id = {subjectUserId}
                FOR UPDATE
                """)
            .ToListAsync(cancellationToken);
        database.OrganizationMembers.RemoveRange(memberships);

        // The only user row this closure writes is the subject's, taken after the membership rows.
        var subject = await database.Users
            .FromSqlInterpolated($"SELECT * FROM asp_net_users WHERE id = {subjectUserId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ResourceNotFoundException();
        var profile = await database.UserProfiles
            .FromSqlInterpolated($"SELECT * FROM user_profiles WHERE user_id = {subjectUserId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ResourceNotFoundException();

        // Re-run under the row locks: the pre-check above ran with the subject unlocked, so a
        // concurrent closure or role change may have moved the ground in the meantime.
        await EnsureNotBlockedAsync(
            actorUserId, subjectUserId, subject.GlobalRole, profile.IsClosed, cancellationToken);

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
                removedProviders,
                removedMembershipCount = memberships.Count
            }), now));

        try
        {
            // No other account moves: the subject is demoted above by closure itself, and dropping
            // their memberships changes nobody else's derived role.
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ResourceConflictException();
        }
    }

    private async Task EnsureNotBlockedAsync(
        Guid actorUserId,
        Guid subjectUserId,
        string globalRole,
        bool isClosed,
        CancellationToken cancellationToken)
    {
        var adminCount = await database.Users.CountAsync(user => user.GlobalRole == GlobalRoles.Admin, cancellationToken);
        var block = AccountClosurePolicy.EvaluateBlock(actorUserId, subjectUserId, globalRole, isClosed, adminCount);
        if (block is null) return;

        throw new ResourceConflictException();
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
