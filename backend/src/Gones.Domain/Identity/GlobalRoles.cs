namespace Gones.Domain.Identity;

public static class GlobalRoles
{
    public const string User = "User";
    public const string Organizer = "Organizer";
    public const string Admin = "Admin";

    public static readonly IReadOnlyList<string> All = [User, Organizer, Admin];
    public static readonly IReadOnlyList<string> Assignable = [Organizer, Admin];

    public static bool IsKnown(string? role) =>
        role is User or Organizer or Admin;

    public static bool IsAssignable(string? role) =>
        role is Organizer or Admin;

    public static int Rank(string role) => role switch
    {
        User => 0,
        Organizer => 1,
        Admin => 2,
        _ => throw new ArgumentException($"Unknown global role '{role}'.", nameof(role))
    };
}

public enum GlobalRoleChangeKind
{
    Grant,
    Revoke
}

public sealed record GlobalRoleChangeDecision(bool Allowed, string? ResultingRole, string? DenialCode, string? DenialMessage)
{
    public static GlobalRoleChangeDecision Allow(string resultingRole) => new(true, resultingRole, null, null);
    public static GlobalRoleChangeDecision Deny(string code, string message) => new(false, null, code, message);
}

public static class GlobalRolePolicy
{
    public static GlobalRoleChangeDecision Evaluate(
        string currentRole,
        string targetRole,
        GlobalRoleChangeKind kind,
        Guid actorUserId,
        Guid subjectUserId,
        int activeAdminCount)
    {
        if (!GlobalRoles.IsKnown(currentRole)) throw new ArgumentException("Current role is unknown.", nameof(currentRole));
        if (!GlobalRoles.IsAssignable(targetRole))
        {
            return GlobalRoleChangeDecision.Deny("invalid_role", "Only Organizer and Admin roles can be granted or revoked.");
        }

        if (kind == GlobalRoleChangeKind.Grant)
        {
            if (GlobalRoles.Rank(currentRole) >= GlobalRoles.Rank(targetRole))
            {
                return GlobalRoleChangeDecision.Allow(currentRole);
            }

            return GlobalRoleChangeDecision.Allow(targetRole);
        }

        // Revoke
        if (GlobalRoles.Rank(currentRole) < GlobalRoles.Rank(targetRole))
        {
            return GlobalRoleChangeDecision.Allow(currentRole);
        }

        if (targetRole == GlobalRoles.Admin)
        {
            if (actorUserId == subjectUserId)
            {
                return GlobalRoleChangeDecision.Deny("self_admin_lockout", "Administrators cannot revoke their own Admin role.");
            }

            if (currentRole == GlobalRoles.Admin && activeAdminCount <= 1)
            {
                return GlobalRoleChangeDecision.Deny("last_admin", "The final Admin cannot be revoked.");
            }

            return GlobalRoleChangeDecision.Allow(GlobalRoles.User);
        }

        // Revoke Organizer
        if (currentRole == GlobalRoles.Admin)
        {
            return GlobalRoleChangeDecision.Deny("admin_retains_organizer", "Admin role already includes Organizer privileges; revoke Admin instead.");
        }

        if (currentRole == GlobalRoles.Organizer)
        {
            return GlobalRoleChangeDecision.Allow(GlobalRoles.User);
        }

        return GlobalRoleChangeDecision.Allow(currentRole);
    }
}
