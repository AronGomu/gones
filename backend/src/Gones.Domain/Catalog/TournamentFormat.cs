using Gones.Domain.Persistence;
using NodaTime;

namespace Gones.Domain.Catalog;

public sealed class TournamentFormat : VersionedEntity
{
    public const int MaximumNameLength = 80;
    public const int MaximumSlugLength = 80;
    public const string LegacySlug = "legacy";
    public const string LegacyName = "Legacy";

    private TournamentFormat() { }

    public string Name { get; private set; } = string.Empty;
    public string Slug { get; private set; } = string.Empty;
    public int SortOrder { get; private set; }
    public Instant CreatedAt { get; private init; }
    public Instant UpdatedAt { get; private set; }
    public Instant? DeletedAt { get; private set; }

    public bool IsActive => DeletedAt is null;

    public static TournamentFormat Create(string name, string slug, int sortOrder, Instant now)
    {
        var format = new TournamentFormat
        {
            CreatedAt = now,
            UpdatedAt = now
        };
        format.Apply(name, slug, sortOrder, now);
        return format;
    }

    public static TournamentFormat CreateLegacy(Instant now) =>
        Create(LegacyName, LegacySlug, sortOrder: 0, now);

    public void Update(string name, string slug, int sortOrder, Instant now)
    {
        if (DeletedAt is not null) throw new InvalidOperationException("Deleted format cannot be updated.");
        Apply(name, slug, sortOrder, now);
    }

    public void SoftDelete(Instant now)
    {
        if (DeletedAt is not null) return;
        if (string.Equals(Slug, LegacySlug, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Legacy format cannot be deleted.");
        }

        DeletedAt = now;
        UpdatedAt = now;
    }

    public void Restore(Instant now)
    {
        if (DeletedAt is null) return;
        DeletedAt = null;
        UpdatedAt = now;
    }

    private void Apply(string name, string slug, int sortOrder, Instant now)
    {
        Name = ValidateName(name);
        Slug = ValidateSlug(slug);
        if (sortOrder < 0) throw new ArgumentOutOfRangeException(nameof(sortOrder), "Sort order cannot be negative.");
        SortOrder = sortOrder;
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

    public static string ValidateSlug(string slug)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(slug);
        var trimmed = slug.Trim().ToLowerInvariant();
        if (trimmed.Length > MaximumSlugLength)
        {
            throw new ArgumentException($"Slug cannot exceed {MaximumSlugLength} characters.", nameof(slug));
        }

        if (trimmed.Any(ch => !(char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_')))
        {
            throw new ArgumentException("Slug may contain only lowercase letters, digits, hyphens, and underscores.", nameof(slug));
        }

        return trimmed;
    }
}

public static class TournamentFormatSelection
{
    /// <summary>
    /// V1 Scheduled Tournament creation requires the active Legacy format among selected formats.
    /// </summary>
    public static void RequireLegacyForV1(IReadOnlyCollection<TournamentFormat> selectedFormats)
    {
        ArgumentNullException.ThrowIfNull(selectedFormats);
        if (selectedFormats.Count == 0)
        {
            throw new ArgumentException("At least one format is required.", nameof(selectedFormats));
        }

        if (selectedFormats.Any(format => !format.IsActive))
        {
            throw new ArgumentException("Deleted formats cannot be selected.", nameof(selectedFormats));
        }

        if (!selectedFormats.Any(format => string.Equals(format.Slug, TournamentFormat.LegacySlug, StringComparison.Ordinal)))
        {
            throw new ArgumentException("V1 tournaments require the Legacy format.", nameof(selectedFormats));
        }
    }
}
