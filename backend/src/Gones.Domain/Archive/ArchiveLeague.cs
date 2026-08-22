using NodaTime;

namespace Gones.Domain.Archive;

/// <summary>
/// Top tier of the three-tier archive. Concurrency is per row: <see cref="Version"/> starts at one and
/// this aggregate bumps it itself, because it is keyed by its document ID rather than by the
/// <c>VersionedEntity</c> surrogate the context auto-bumps.
/// </summary>
public sealed class ArchiveLeague
{
    public const int MaximumDocumentIdLength = 200;
    public const int MaximumNameLength = 200;

    public required string DocumentId { get; init; }
    public string Name { get; private set; } = null!;
    public Instant CreatedAt { get; private set; }
    public Instant UpdatedAt { get; private set; }
    public int Version { get; private set; } = 1;
    public Instant? DeletedAt { get; private set; }

    public static ArchiveLeague Create(string documentId, string name, Instant now)
    {
        ArchiveValidation.ValidateString(documentId, "documentId", MaximumDocumentIdLength);
        ArchiveValidation.ValidateString(name, "name", MaximumNameLength);
        return new ArchiveLeague
        {
            DocumentId = documentId,
            Name = name,
            CreatedAt = now,
            UpdatedAt = now
        };
    }

    public void Rename(string name, Instant now)
    {
        if (DeletedAt is not null) throw new InvalidOperationException("Deleted archive League cannot be changed.");
        ArchiveValidation.ValidateString(name, "name", MaximumNameLength);
        if (name == Name) return;
        Name = name;
        UpdatedAt = now;
        Version = checked(Version + 1);
    }

    public void SoftDelete(Instant now)
    {
        if (DeletedAt is not null) throw new InvalidOperationException("Archive League is already deleted.");
        DeletedAt = now;
        UpdatedAt = now;
        Version = checked(Version + 1);
    }
}
