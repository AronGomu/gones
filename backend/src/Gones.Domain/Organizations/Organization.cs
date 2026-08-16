using System.Net.Mail;
using System.Text;
using Gones.Domain.Persistence;
using NodaTime;

namespace Gones.Domain.Organizations;

/// <summary>Nobody owns an organization: every member is an Organizer with equal rights (ADR 0041).</summary>
public static class OrganizationRoles
{
    public const string Organizer = "Organizer";

    public static readonly IReadOnlyList<string> All = [Organizer];

    public static bool IsKnown(string? role) => role is Organizer;

    public static bool IsMemberRole(string? role) => role is Organizer;

    public static string RequireKnown(string role)
    {
        if (!IsKnown(role)) throw new ArgumentException("Organization role must be Organizer.", nameof(role));
        return role;
    }
}

public sealed class Organization : VersionedEntity
{
    public const int MaximumNameLength = 120;
    public const int MaximumDescriptionLength = 2000;
    public const int MaximumWebsiteLength = 300;
    public const int MaximumContactEmailLength = 254;

    private Organization() { }

    public string Name { get; private set; } = string.Empty;
    public string NormalizedName { get; private set; } = string.Empty;
    public string? Description { get; private set; }
    public string? Website { get; private set; }
    public string? ContactEmail { get; private set; }
    public Instant CreatedAt { get; private init; }
    public Instant UpdatedAt { get; private set; }
    public Instant? DeletedAt { get; private set; }

    public bool IsActive => DeletedAt is null;

    public static Organization Create(
        string name,
        string? description,
        string? website,
        string? contactEmail,
        Instant now)
    {
        var organization = new Organization
        {
            CreatedAt = now,
            UpdatedAt = now
        };
        organization.Apply(name, description, website, contactEmail, now);
        return organization;
    }

    public void Update(string name, string? description, string? website, string? contactEmail, Instant now)
    {
        if (DeletedAt is not null) throw new InvalidOperationException("Deleted organization cannot be updated.");
        Apply(name, description, website, contactEmail, now);
    }

    public void SoftDelete(Instant now)
    {
        if (DeletedAt is not null) return;
        DeletedAt = now;
        UpdatedAt = now;
    }

    public void Restore(Instant now)
    {
        if (DeletedAt is null) return;
        DeletedAt = null;
        UpdatedAt = now;
    }

    private void Apply(string name, string? description, string? website, string? contactEmail, Instant now)
    {
        Name = ValidateName(name);
        NormalizedName = NormalizeName(Name);
        Description = ValidateOptional(description, nameof(description), MaximumDescriptionLength);
        Website = ValidateWebsite(website);
        ContactEmail = ValidateContactEmail(contactEmail);
        UpdatedAt = now;
    }

    public static string ValidateName(string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var trimmed = name.Trim();
        if (trimmed.Length > MaximumNameLength)
        {
            throw new ArgumentException($"Name cannot exceed {MaximumNameLength} characters.", nameof(name));
        }

        return trimmed;
    }

    public static string NormalizeName(string name) =>
        ValidateName(name).Normalize(NormalizationForm.FormKC).ToUpperInvariant();

    private static string? ValidateOptional(string? value, string parameterName, int maximumLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        if (trimmed.Length > maximumLength)
        {
            throw new ArgumentException($"Value cannot exceed {maximumLength} characters.", parameterName);
        }

        return trimmed;
    }

    private static string? ValidateWebsite(string? website)
    {
        var trimmed = ValidateOptional(website, nameof(website), MaximumWebsiteLength);
        if (trimmed is null) return null;
        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            || string.IsNullOrWhiteSpace(uri.Host))
        {
            throw new ArgumentException("Website must be an absolute http or https URL.", nameof(website));
        }

        return trimmed;
    }

    private static string? ValidateContactEmail(string? contactEmail)
    {
        var trimmed = ValidateOptional(contactEmail, nameof(contactEmail), MaximumContactEmailLength);
        if (trimmed is null) return null;
        try
        {
            _ = new MailAddress(trimmed);
        }
        catch (FormatException)
        {
            throw new ArgumentException("Contact email format is invalid.", nameof(contactEmail));
        }

        return trimmed;
    }
}

public sealed class OrganizationMember : VersionedEntity
{
    private OrganizationMember() { }

    public Guid OrganizationId { get; private init; }
    public Guid UserId { get; private init; }
    public string Role { get; private set; } = OrganizationRoles.Organizer;
    public Instant CreatedAt { get; private init; }
    public Instant UpdatedAt { get; private set; }

    public static OrganizationMember Create(Guid organizationId, Guid userId, string role, Instant now)
    {
        if (organizationId == Guid.Empty) throw new ArgumentException("Organization ID cannot be empty.", nameof(organizationId));
        if (userId == Guid.Empty) throw new ArgumentException("User ID cannot be empty.", nameof(userId));
        return new OrganizationMember
        {
            OrganizationId = organizationId,
            UserId = userId,
            Role = OrganizationRoles.RequireKnown(role),
            CreatedAt = now,
            UpdatedAt = now
        };
    }

    public void ChangeRole(string role, Instant now)
    {
        Role = OrganizationRoles.RequireKnown(role);
        UpdatedAt = now;
    }
}

public sealed class OrganizationBlockedUser : VersionedEntity
{
    public const int MaximumReasonLength = 500;

    private OrganizationBlockedUser() { }

    public Guid OrganizationId { get; private init; }
    public Guid UserId { get; private init; }
    public string Reason { get; private init; } = "Unspecified";
    public Guid? BlockedByUserId { get; private init; }
    public bool IsActive { get; private set; }
    public Instant BlockedAt { get; private init; }
    public Instant? ExpiresAt { get; private init; }
    public Guid? UnblockedByUserId { get; private set; }
    public Instant? UnblockedAt { get; private set; }

    public static OrganizationBlockedUser Block(
        Guid organizationId,
        Guid userId,
        string reason,
        Guid blockedByUserId,
        Instant now,
        Instant? expiresAt = null)
    {
        if (blockedByUserId == Guid.Empty) throw new ArgumentException("Actor ID cannot be empty.", nameof(blockedByUserId));
        return Create(organizationId, userId, reason, blockedByUserId, now, expiresAt);
    }

    public static OrganizationBlockedUser Block(Guid organizationId, Guid userId, Instant now, Instant? expiresAt = null) =>
        Create(organizationId, userId, "Unspecified", null, now, expiresAt);

    public bool AppliesAt(Instant now) => IsActive && (ExpiresAt is null || ExpiresAt > now);

    public void Unblock(Guid actorUserId, Instant now)
    {
        if (actorUserId == Guid.Empty) throw new ArgumentException("Actor ID cannot be empty.", nameof(actorUserId));
        if (!IsActive) throw new InvalidOperationException("Block is already inactive.");
        if (now < BlockedAt) throw new ArgumentOutOfRangeException(nameof(now));
        IsActive = false;
        UnblockedByUserId = actorUserId;
        UnblockedAt = now;
    }

    private static OrganizationBlockedUser Create(
        Guid organizationId,
        Guid userId,
        string reason,
        Guid? blockedByUserId,
        Instant now,
        Instant? expiresAt)
    {
        if (organizationId == Guid.Empty) throw new ArgumentException("Organization ID cannot be empty.", nameof(organizationId));
        if (userId == Guid.Empty) throw new ArgumentException("User ID cannot be empty.", nameof(userId));
        ArgumentException.ThrowIfNullOrWhiteSpace(reason);
        var trimmedReason = reason.Trim();
        if (trimmedReason.Length > MaximumReasonLength) throw new ArgumentException($"Reason cannot exceed {MaximumReasonLength} characters.", nameof(reason));
        if (expiresAt <= now) throw new ArgumentOutOfRangeException(nameof(expiresAt), "Expiry must be after block time.");
        return new OrganizationBlockedUser
        {
            OrganizationId = organizationId,
            UserId = userId,
            Reason = trimmedReason,
            BlockedByUserId = blockedByUserId,
            IsActive = true,
            BlockedAt = now,
            ExpiresAt = expiresAt
        };
    }
}

public sealed class OrganizationNotificationSettings : VersionedEntity
{
    private OrganizationNotificationSettings() { }

    public Guid OrganizationId { get; private init; }
    public bool NotifyOnRegistration { get; private set; }
    public bool NotifyOnUnregistration { get; private set; }
    public Instant UpdatedAt { get; private set; }

    public static OrganizationNotificationSettings CreateDefault(Guid organizationId, Instant now)
    {
        if (organizationId == Guid.Empty) throw new ArgumentException("Organization ID cannot be empty.", nameof(organizationId));
        return new OrganizationNotificationSettings
        {
            OrganizationId = organizationId,
            NotifyOnRegistration = false,
            NotifyOnUnregistration = false,
            UpdatedAt = now
        };
    }

    public void Update(bool notifyOnRegistration, bool notifyOnUnregistration, Instant now)
    {
        NotifyOnRegistration = notifyOnRegistration;
        NotifyOnUnregistration = notifyOnUnregistration;
        UpdatedAt = now;
    }
}
