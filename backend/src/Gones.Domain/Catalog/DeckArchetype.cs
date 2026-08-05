using System.Text.RegularExpressions;
using Gones.Domain.Persistence;
using NodaTime;

namespace Gones.Domain.Catalog;

public sealed partial class DeckArchetype : VersionedEntity
{
    public const int MaximumNameLength = 120;

    private DeckArchetype() { }

    public string Name { get; private set; } = string.Empty;
    public string NormalizedName { get; private set; } = string.Empty;
    public Instant CreatedAt { get; private init; }
    public Instant UpdatedAt { get; private set; }
    public Instant? DeletedAt { get; private set; }

    /// <summary>Active archetypes are selectable; soft-deleted ones only preserve historical labels.</summary>
    public bool IsActive => DeletedAt is null;

    public static DeckArchetype Create(string name, Instant now)
    {
        var archetype = new DeckArchetype
        {
            CreatedAt = now,
            UpdatedAt = now
        };
        archetype.Apply(name, now);
        return archetype;
    }

    public void Rename(string name, Instant now)
    {
        if (DeletedAt is not null) throw new InvalidOperationException("Deleted Deck Archetype cannot be renamed.");
        Apply(name, now);
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

    private void Apply(string name, Instant now)
    {
        Name = ValidateName(name);
        NormalizedName = NormalizeKey(Name);
        UpdatedAt = now;
    }

    /// <summary>Trims and collapses internal whitespace — mirrors the frontend `normalizeArchetypeName`.</summary>
    public static string NormalizeName(string? value) => WhitespaceRegex().Replace((value ?? string.Empty).Trim(), " ");

    /// <summary>Case- and whitespace-insensitive uniqueness key — mirrors the frontend `archetypeKey`.</summary>
    public static string NormalizeKey(string? value) => NormalizeName(value).ToLowerInvariant();

    public static string ValidateName(string name)
    {
        var normalized = NormalizeName(name);
        if (normalized.Length == 0) throw new ArgumentException("Deck Archetype name is required.", nameof(name));
        if (normalized.Length > MaximumNameLength)
        {
            throw new ArgumentException($"Deck Archetype name cannot exceed {MaximumNameLength} characters.", nameof(name));
        }

        return normalized;
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();
}
