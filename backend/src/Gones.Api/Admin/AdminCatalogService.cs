using System.Text.Json;
using Gones.Api.Errors;
using Gones.Domain.Catalog;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Admin;

internal sealed class AdminCatalogService(GonesDbContext database, IClock clock)
{
    public async Task<TournamentFormat> CreateAsync(Guid actorUserId, string name, string slug, int sortOrder, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        TournamentFormat format;
        try
        {
            format = TournamentFormat.Create(name, slug, sortOrder, now);
        }
        catch (ArgumentException exception)
        {
            throw Validation(exception);
        }

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        if (await database.TournamentFormats.AnyAsync(item => item.Slug == format.Slug, cancellationToken))
        {
            throw new ResourceConflictException();
        }

        database.TournamentFormats.Add(format);
        database.AuditRecords.Add(NewAudit(actorUserId, "admin.format.created", "tournament_format", format.Id,
            JsonSerializer.Serialize(new { fields = new[] { "name", "slug", "sortOrder" }, slug = format.Slug }), now));
        try
        {
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return format;
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ResourceConflictException();
        }
    }

    public async Task<TournamentFormat> UpdateAsync(Guid actorUserId, Guid formatId, string name, string slug, int sortOrder, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var format = await database.TournamentFormats
            .FromSqlInterpolated($"SELECT * FROM tournament_formats WHERE id = {formatId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ResourceNotFoundException();

        var previousSlug = format.Slug;
        try
        {
            format.Update(name, slug, sortOrder, clock.GetCurrentInstant());
        }
        catch (ArgumentException exception)
        {
            throw Validation(exception);
        }
        catch (InvalidOperationException)
        {
            throw new ResourceConflictException();
        }

        if (!string.Equals(previousSlug, format.Slug, StringComparison.Ordinal)
            && await database.TournamentFormats.AnyAsync(item => item.Id != format.Id && item.Slug == format.Slug, cancellationToken))
        {
            throw new ResourceConflictException();
        }

        database.AuditRecords.Add(NewAudit(actorUserId, "admin.format.updated", "tournament_format", format.Id,
            JsonSerializer.Serialize(new { fields = new[] { "name", "slug", "sortOrder" }, slug = format.Slug }), clock.GetCurrentInstant()));
        try
        {
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return format;
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ResourceConflictException();
        }
    }

    public async Task SoftDeleteAsync(Guid actorUserId, Guid formatId, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var format = await database.TournamentFormats
            .FromSqlInterpolated($"SELECT * FROM tournament_formats WHERE id = {formatId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ResourceNotFoundException();

        try
        {
            format.SoftDelete(clock.GetCurrentInstant());
        }
        catch (InvalidOperationException)
        {
            throw new ResourceConflictException();
        }

        database.AuditRecords.Add(NewAudit(actorUserId, "admin.format.deleted", "tournament_format", format.Id,
            JsonSerializer.Serialize(new { fields = new[] { "deletedAt" }, slug = format.Slug }), clock.GetCurrentInstant()));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<DeckArchetype> CreateArchetypeAsync(Guid actorUserId, string name, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        DeckArchetype archetype;
        try
        {
            archetype = DeckArchetype.Create(name, now);
        }
        catch (ArgumentException exception)
        {
            throw Validation(exception);
        }

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        if (await database.DeckArchetypes.AnyAsync(item => item.NormalizedName == archetype.NormalizedName, cancellationToken))
        {
            throw new ResourceConflictException();
        }

        database.DeckArchetypes.Add(archetype);
        database.AuditRecords.Add(NewAudit(actorUserId, "admin.deck_archetype.created", "deck_archetype", archetype.Id,
            JsonSerializer.Serialize(new { fields = new[] { "name" }, name = archetype.Name }), now));
        try
        {
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return archetype;
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ResourceConflictException();
        }
    }

    public async Task<DeckArchetype> RenameArchetypeAsync(Guid actorUserId, Guid archetypeId, string name, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var archetype = await database.DeckArchetypes
            .FromSqlInterpolated($"SELECT * FROM deck_archetypes WHERE id = {archetypeId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ResourceNotFoundException();

        try
        {
            archetype.Rename(name, clock.GetCurrentInstant());
        }
        catch (ArgumentException exception)
        {
            throw Validation(exception);
        }
        catch (InvalidOperationException)
        {
            throw new ResourceConflictException();
        }

        if (await database.DeckArchetypes.AnyAsync(item => item.Id != archetype.Id && item.NormalizedName == archetype.NormalizedName, cancellationToken))
        {
            throw new ResourceConflictException();
        }

        database.AuditRecords.Add(NewAudit(actorUserId, "admin.deck_archetype.renamed", "deck_archetype", archetype.Id,
            JsonSerializer.Serialize(new { fields = new[] { "name" }, name = archetype.Name }), clock.GetCurrentInstant()));
        try
        {
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return archetype;
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ResourceConflictException();
        }
    }

    public async Task SoftDeleteArchetypeAsync(Guid actorUserId, Guid archetypeId, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var archetype = await database.DeckArchetypes
            .FromSqlInterpolated($"SELECT * FROM deck_archetypes WHERE id = {archetypeId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ResourceNotFoundException();

        archetype.SoftDelete(clock.GetCurrentInstant());
        database.AuditRecords.Add(NewAudit(actorUserId, "admin.deck_archetype.deleted", "deck_archetype", archetype.Id,
            JsonSerializer.Serialize(new { fields = new[] { "deletedAt" }, name = archetype.Name }), clock.GetCurrentInstant()));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task RestoreArchetypeAsync(Guid actorUserId, Guid archetypeId, CancellationToken cancellationToken)
    {
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var archetype = await database.DeckArchetypes
            .FromSqlInterpolated($"SELECT * FROM deck_archetypes WHERE id = {archetypeId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ResourceNotFoundException();

        archetype.Restore(clock.GetCurrentInstant());
        database.AuditRecords.Add(NewAudit(actorUserId, "admin.deck_archetype.restored", "deck_archetype", archetype.Id,
            JsonSerializer.Serialize(new { fields = new[] { "deletedAt" }, name = archetype.Name }), clock.GetCurrentInstant()));
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<DeckArchetypeImportResult> ImportArchetypesAsync(Guid actorUserId, IReadOnlyList<string> names, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var incoming = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var name in names)
        {
            string normalized;
            try
            {
                normalized = DeckArchetype.ValidateName(name);
            }
            catch (ArgumentException exception)
            {
                throw Validation(exception);
            }

            if (seen.Add(DeckArchetype.NormalizeKey(normalized))) incoming.Add(normalized);
        }

        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var existing = await database.DeckArchetypes
            .FromSqlRaw("SELECT * FROM deck_archetypes FOR UPDATE")
            .ToDictionaryAsync(item => item.NormalizedName, StringComparer.Ordinal, cancellationToken);

        var added = 0;
        var restored = 0;
        var skipped = 0;
        foreach (var name in incoming)
        {
            var key = DeckArchetype.NormalizeKey(name);
            if (existing.TryGetValue(key, out var match))
            {
                if (match.IsActive)
                {
                    skipped += 1;
                    continue;
                }

                match.Restore(now);
                restored += 1;
                continue;
            }

            database.DeckArchetypes.Add(DeckArchetype.Create(name, now));
            added += 1;
        }

        database.AuditRecords.Add(new AuditRecord
        {
            ActorId = actorUserId,
            Action = "admin.deck_archetype.imported",
            EntityType = "deck_archetype",
            EntityId = "import",
            RedactedDiff = JsonSerializer.Serialize(new { added, restored, skipped }),
            OccurredAt = now
        });
        try
        {
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync(cancellationToken);
            throw new ResourceConflictException();
        }

        var total = await database.DeckArchetypes.CountAsync(item => item.DeletedAt == null, cancellationToken);
        return new DeckArchetypeImportResult(added, restored, skipped, total);
    }

    private static ApiValidationException Validation(ArgumentException exception) =>
        new(new Dictionary<string, string[]> { [exception.ParamName ?? "request"] = [exception.Message] });

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

internal sealed record DeckArchetypeImportResult(int Added, int Restored, int Skipped, int Total);
