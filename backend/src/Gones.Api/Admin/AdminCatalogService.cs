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
