namespace Gones.Domain.Identity;

public static class AccountClosureIdentity
{
    public const string OpaqueEmailDomain = "closed.invalid";
    public const string ClosedFirstName = "Closed";
    public const string ClosedLastName = "User";

    public static string OpaqueUsername(Guid userId)
    {
        // Keep a deterministic unique opaque handle within the username limit.
        var hex = userId.ToString("N");
        return $"c-{hex[..12]}";
    }

    public static string OpaqueEmail(Guid userId) =>
        $"closed-{userId:N}@{OpaqueEmailDomain}";

    public static string OpaqueUserName(Guid userId) => OpaqueUsername(userId);
}

public sealed record SoleOwnerOrganizationImpact(
    Guid OrganizationId,
    string OrganizationName,
    Guid? SuggestedNewOwnerUserId,
    string? SuggestedNewOwnerUsername);

public sealed record AccountClosureImpact(
    Guid UserId,
    string Username,
    string Email,
    string GlobalRole,
    bool IsClosed,
    bool IsLastAdmin,
    bool IsSelf,
    bool CanClose,
    string? BlockReason,
    IReadOnlyList<SoleOwnerOrganizationImpact> SoleOwnedOrganizations,
    IReadOnlyList<Guid> OtherMembershipOrganizationIds);

public static class AccountClosurePolicy
{
    public static string? EvaluateBlock(
        Guid actorUserId,
        Guid subjectUserId,
        string subjectGlobalRole,
        bool subjectAlreadyClosed,
        int activeAdminCount,
        IReadOnlyList<Guid> soleOwnedOrganizationIds,
        IReadOnlySet<Guid> transferOrganizationIds)
    {
        if (subjectAlreadyClosed) return "already_closed";
        if (actorUserId == subjectUserId) return "self_close";
        if (subjectGlobalRole == GlobalRoles.Admin && activeAdminCount <= 1) return "last_admin";

        foreach (var organizationId in soleOwnedOrganizationIds)
        {
            if (!transferOrganizationIds.Contains(organizationId))
            {
                return "missing_owner_transfer";
            }
        }

        return null;
    }

    public static bool RequiresTransfer(IReadOnlyList<Guid> soleOwnedOrganizationIds) =>
        soleOwnedOrganizationIds.Count > 0;
}
