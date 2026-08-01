namespace Gones.Domain.Identity;

public enum AdminBootstrapOutcome
{
    Promoted,
    AlreadyAdminNoOp,
    AlreadyConsumedNoOp
}

public sealed record AdminBootstrapDecision(
    AdminBootstrapOutcome Outcome,
    string Message,
    bool IsSuccess,
    int ExitCode)
{
    public static AdminBootstrapDecision Promoted(string email) =>
        new(AdminBootstrapOutcome.Promoted, $"Promoted verified account '{email}' to Admin.", true, 0);

    public static AdminBootstrapDecision AlreadyAdmin(string email) =>
        new(AdminBootstrapOutcome.AlreadyAdminNoOp, $"Account '{email}' is already Admin; bootstrap marker consumed.", true, 0);

    public static AdminBootstrapDecision AlreadyConsumed() =>
        new(AdminBootstrapOutcome.AlreadyConsumedNoOp, "Admin bootstrap marker already consumed; safe no-op.", true, 0);
}

public static class AdminBootstrapPolicy
{
    public const string MarkerKey = "admin-bootstrap";
    public const string BootstrapEmailKey = "GONES_BOOTSTRAP_ADMIN_EMAIL";

    public static string NormalizeEmail(string email)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(email);
        return email.Trim().Normalize(System.Text.NormalizationForm.FormKC).ToUpperInvariant();
    }

    public static void EnsureConfiguredEmailMatches(string? configuredEmail, string requestedEmail)
    {
        if (string.IsNullOrWhiteSpace(configuredEmail))
        {
            throw new InvalidOperationException($"{BootstrapEmailKey} is required for admin bootstrap.");
        }

        if (!string.Equals(NormalizeEmail(configuredEmail), NormalizeEmail(requestedEmail), StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Bootstrap email does not match configured GONES_BOOTSTRAP_ADMIN_EMAIL.");
        }
    }

    public static AdminBootstrapDecision Decide(bool markerConsumed, bool userIsAdmin, string email)
    {
        if (markerConsumed)
        {
            return userIsAdmin ? AdminBootstrapDecision.AlreadyAdmin(email) : AdminBootstrapDecision.AlreadyConsumed();
        }

        return userIsAdmin
            ? AdminBootstrapDecision.AlreadyAdmin(email)
            : AdminBootstrapDecision.Promoted(email);
    }
}
