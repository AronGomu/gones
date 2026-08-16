using Gones.Api.Errors;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Gones.Api.Organizations;

internal sealed class OrganizationAccess
{
    public required Organization Organization { get; init; }
    public OrganizationMember? Membership { get; init; }
    public required bool IsAdmin { get; init; }

    public bool IsMember => IsAdmin || Membership is not null;
}

public interface IOrganizationDeleteDependency
{
    Task<IReadOnlyList<string>> GetBlockersAsync(Guid organizationId, CancellationToken cancellationToken);
}

/// <summary>
/// Loads org-scoped authorization. Missing, deleted (non-admin), and unauthorized access
/// all surface as ResourceNotFoundException so callers cannot distinguish existence (IDOR-safe).
/// </summary>
internal sealed class OrganizationAccessService(GonesDbContext database)
{
    public async Task<OrganizationAccess> LoadAsync(
        Guid organizationId,
        Guid userId,
        bool isAdmin,
        bool includeDeletedForAdmin,
        CancellationToken cancellationToken)
    {
        var organization = await database.Organizations.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == organizationId, cancellationToken);
        if (organization is null)
        {
            throw new ResourceNotFoundException();
        }

        if (organization.DeletedAt is not null && !(isAdmin && includeDeletedForAdmin))
        {
            throw new ResourceNotFoundException();
        }

        var membership = await database.OrganizationMembers.AsNoTracking()
            .SingleOrDefaultAsync(
                item => item.OrganizationId == organizationId && item.UserId == userId,
                cancellationToken);

        return new OrganizationAccess
        {
            Organization = organization,
            Membership = membership,
            IsAdmin = isAdmin
        };
    }

    public async Task<OrganizationAccess> RequireMemberAsync(
        Guid organizationId,
        Guid userId,
        bool isAdmin,
        CancellationToken cancellationToken)
    {
        var access = await LoadAsync(organizationId, userId, isAdmin, includeDeletedForAdmin: isAdmin, cancellationToken);
        if (!access.IsMember) throw new ResourceNotFoundException();
        return access;
    }
}
