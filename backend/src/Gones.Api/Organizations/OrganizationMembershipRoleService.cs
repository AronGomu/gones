using System.Text.Json;
using Gones.Api.Identity;
using Gones.Domain.Identity;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Organizations;

/// <summary>
/// The global <c>Organizer</c> role is derived from organization membership, never granted by hand:
/// holding at least one membership in a live organization is what makes an account an Organizer, and
/// losing the last one takes it away again. <c>Admin</c> is outside the derivation in both
/// directions — it is granted by an administrator and only an administrator revokes it.
///
/// The sync runs inside the caller's transaction, so a membership write and the role it implies
/// commit together or not at all. A change rotates the security stamp and revokes the subject's
/// refresh sessions, which is what makes the demotion take effect on the subject's very next request
/// rather than at their next token refresh: <c>ValidateSecurityStampAndRoleAsync</c> compares both
/// the stamp and the baked-in role claim against the stored row on every authenticated call.
///
/// <para><b>Lock order.</b> Every transaction that writes memberships takes its row locks in the
/// order <c>organizations</c> → <c>organization_members</c> → <c>asp_net_users</c> → the rows hanging
/// off a user (<c>user_profiles</c>, <c>refresh_sessions</c>, <c>external_identities</c>), and locks
/// several rows of the same table in ascending id order. The derived role is a consequence of the
/// membership rows, so the subject's user row can only be locked after them - which fixes the order
/// for everyone else: <see cref="Gones.Api.Admin.AdminAccountService"/> reads the subject unlocked for
/// its pre-checks and takes the user locks after the organization work, and
/// <see cref="OrganizationService"/> calls this sync last. The one apparent exception,
/// <c>OrganizationService.CreateAsync</c>, locks the owner before inserting the organization, but the
/// only other rows it touches are ones it creates itself and no other transaction can see, so it
/// cannot be part of a wait cycle.</para>
/// </summary>
internal sealed class OrganizationMembershipRoleService(
    GonesDbContext database,
    RefreshSessionService sessionService,
    IClock clock)
{
    /// <summary>
    /// Syncs several subjects in one pass, always in ascending id order so that two transactions
    /// touching the same pair of accounts can never take those row locks the opposite way round.
    /// </summary>
    public async Task SyncAfterMembershipChangeAsync(
        Guid actorUserId,
        IEnumerable<Guid> subjectUserIds,
        CancellationToken cancellationToken)
    {
        foreach (var subjectUserId in subjectUserIds.Distinct().OrderBy(item => item))
        {
            await SyncAfterMembershipChangeAsync(actorUserId, subjectUserId, cancellationToken);
        }
    }

    public async Task SyncAfterMembershipChangeAsync(
        Guid actorUserId,
        Guid subjectUserId,
        CancellationToken cancellationToken)
    {
        var subject = await database.Users
            .FromSqlInterpolated($"SELECT * FROM asp_net_users WHERE id = {subjectUserId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
        if (subject is null) return;

        var membershipCount = await database.OrganizationMembers
            .Join(
                database.Organizations.Where(organization => organization.DeletedAt == null),
                member => member.OrganizationId,
                organization => organization.Id,
                (member, _) => member)
            .CountAsync(member => member.UserId == subjectUserId, cancellationToken);

        var previousRole = subject.GlobalRole;
        var nextRole = NextRole(previousRole, membershipCount);
        if (nextRole is null)
        {
            database.AuditRecords.Add(NewAudit(actorUserId, "organization.role.unchanged", subjectUserId,
                JsonSerializer.Serialize(new { globalRole = previousRole, membershipCount })));
            await database.SaveChangesAsync(cancellationToken);
            return;
        }

        subject.AssignGlobalRole(nextRole);
        subject.SecurityStamp = Guid.NewGuid().ToString("N");
        await sessionService.RevokeAllForRoleChangeAsync(subjectUserId, cancellationToken);
        database.AuditRecords.Add(NewAudit(actorUserId, "organization.role.derived", subjectUserId,
            JsonSerializer.Serialize(new
            {
                before = previousRole,
                after = nextRole,
                membershipCount,
                fields = new[] { "globalRole", "securityStamp" }
            })));
        await database.SaveChangesAsync(cancellationToken);
    }

    /// <summary>The role the subject must end up with, or null when membership implies no change.</summary>
    private static string? NextRole(string currentRole, int membershipCount) => currentRole switch
    {
        GlobalRoles.Admin => null,
        not GlobalRoles.Organizer when membershipCount > 0 => GlobalRoles.Organizer,
        GlobalRoles.Organizer when membershipCount == 0 => GlobalRoles.User,
        _ => null
    };

    private AuditRecord NewAudit(Guid actorId, string action, Guid subjectUserId, string diff) => new()
    {
        ActorId = actorId,
        Action = action,
        EntityType = "user",
        EntityId = subjectUserId.ToString("D"),
        RedactedDiff = diff,
        OccurredAt = clock.GetCurrentInstant()
    };
}
