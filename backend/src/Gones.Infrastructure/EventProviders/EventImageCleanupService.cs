using Gones.Application.Events;
using Gones.Domain.Calendar;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NodaTime;

namespace Gones.Infrastructure.EventProviders;

public sealed class EventImageCleanupService(
    GonesDbContext database,
    IEventImageObjectStore objects,
    IClock clock,
    ILogger<EventImageCleanupService> logger)
{
    public const int BatchSize = 100;

    public async Task EnqueueAndDeleteAsync(EventImage image, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(image);
        EnqueueAndRemove([image], clock.GetCurrentInstant());
        await database.SaveChangesAsync(cancellationToken);
    }

    public async Task<int> CleanupProposalImagesAsync(Guid proposalId, CancellationToken cancellationToken)
    {
        if (proposalId == Guid.Empty) throw new ArgumentException("Proposal ID cannot be empty.", nameof(proposalId));
        database.ChangeTracker.Clear();
        var now = clock.GetCurrentInstant();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var proposal = await database.EventProposals
            .FromSqlInterpolated($"SELECT * FROM event_proposals WHERE id = {proposalId} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
        if (proposal is null
            || (proposal.Status != TournamentProposalStatus.Rejected
                && !(proposal.IsPending && proposal.ExpiresAt <= now)))
        {
            await transaction.RollbackAsync(cancellationToken);
            return 0;
        }

        var images = await database.EventImages
            .Where(image => image.ProposalId == proposalId && image.State == EventImageState.ProposalOwned)
            .OrderBy(image => image.SortOrder)
            .ToListAsync(cancellationToken);
        EnqueueAndRemove(images, now);
        if (images.Count > 0) await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        await ProcessDueObjectDeletionsAsync(cancellationToken);
        return images.Count;
    }

    public async Task<int> ProcessImageObjectDeletionsAsync(Guid imageId, CancellationToken cancellationToken) =>
        await ProcessAsync(await ClaimDueAsync(imageId, cancellationToken), cancellationToken);

    public async Task<int> ProcessDueObjectDeletionsAsync(CancellationToken cancellationToken) =>
        await ProcessAsync(await ClaimDueAsync(null, cancellationToken), cancellationToken);

    public async Task<int> SweepExpiredAsync(CancellationToken cancellationToken)
    {
        database.ChangeTracker.Clear();
        var now = clock.GetCurrentInstant();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var proposals = await database.EventProposals.FromSqlInterpolated($$"""
            SELECT proposal.* FROM event_proposals proposal
            WHERE (proposal.status = 'Rejected' OR (proposal.status = 'Pending' AND proposal.expires_at <= {{now}}))
              AND EXISTS (
                SELECT 1 FROM event_images image
                WHERE image.proposal_id = proposal.id AND image.state = 'ProposalOwned'
              )
            ORDER BY proposal.expires_at, proposal.id
            LIMIT {{BatchSize}}
            FOR UPDATE SKIP LOCKED
            """).ToListAsync(cancellationToken);
        var proposalIds = proposals.Select(proposal => proposal.Id).ToArray();
        var expired = proposalIds.Length == 0
            ? []
            : await database.EventImages
                .Where(image => image.ProposalId != null
                    && proposalIds.Contains(image.ProposalId.Value)
                    && image.State == EventImageState.ProposalOwned)
                .OrderBy(image => image.ProposalId)
                .ThenBy(image => image.SortOrder)
                .Take(BatchSize)
                .ToListAsync(cancellationToken);
        var remaining = BatchSize - expired.Count;
        if (remaining > 0)
        {
            expired.AddRange(await database.EventImages.FromSqlInterpolated($$"""
                SELECT * FROM event_images
                WHERE state = 'Temporary' AND expires_at <= {{now}}
                ORDER BY expires_at, id
                LIMIT {{remaining}}
                FOR UPDATE SKIP LOCKED
                """).ToListAsync(cancellationToken));
        }
        EnqueueAndRemove(expired, now);
        if (expired.Count > 0) await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        await ProcessDueObjectDeletionsAsync(cancellationToken);
        return expired.Count;
    }

    private void EnqueueAndRemove(IReadOnlyCollection<EventImage> images, Instant now)
    {
        foreach (var image in images)
        {
            foreach (var width in EventImage.VariantWidthsFor(image.Width))
            {
                database.EventImageObjectDeletions.Add(EventImageObjectDeletion.Create(
                    image.Id,
                    EventImageObjectKeys.Variant(image.Id, width),
                    now));
            }
        }
        database.EventImages.RemoveRange(images);
    }

    private async Task<IReadOnlyList<EventImageObjectDeletion>> ClaimDueAsync(Guid? imageId, CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        IQueryable<EventImageObjectDeletion> query;
        if (imageId is { } id)
        {
            query = database.EventImageObjectDeletions.FromSqlInterpolated($$"""
                SELECT * FROM event_image_object_deletions
                WHERE image_id = {{id}} AND next_attempt_at <= {{now}}
                ORDER BY object_key
                FOR UPDATE SKIP LOCKED
                """);
        }
        else
        {
            query = database.EventImageObjectDeletions.FromSqlInterpolated($$"""
                SELECT * FROM event_image_object_deletions
                WHERE next_attempt_at <= {{now}}
                ORDER BY next_attempt_at, object_key
                LIMIT {{BatchSize}}
                FOR UPDATE SKIP LOCKED
                """);
        }
        var due = await query.ToListAsync(cancellationToken);
        foreach (var deletion in due) deletion.DeferUntil(now + Duration.FromMinutes(15));
        if (due.Count > 0) await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return due;
    }

    private async Task<int> ProcessAsync(IReadOnlyCollection<EventImageObjectDeletion> due, CancellationToken cancellationToken)
    {
        var completed = 0;
        foreach (var deletion in due)
        {
            try
            {
                await objects.DeleteAsync(deletion.ObjectKey, cancellationToken);
                database.EventImageObjectDeletions.Remove(deletion);
                completed++;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                deletion.RecordFailure(exception, clock.GetCurrentInstant());
                logger.LogWarning(
                    EventImageCleanupLogEvents.ObjectDeleteFailed,
                    "Event image object deletion deferred; Event={Event}; ImageId={ImageId}; ObjectKey={ObjectKey}; Attempts={Attempts}; NextAttemptAt={NextAttemptAt}; ExceptionType={ExceptionType}",
                    "event_image.object_delete.deferred",
                    deletion.ImageId,
                    deletion.ObjectKey,
                    deletion.Attempts,
                    deletion.NextAttemptAt.ToDateTimeOffset(),
                    exception.GetType().Name);
            }
        }
        if (due.Count > 0) await database.SaveChangesAsync(cancellationToken);
        return completed;
    }
}

public static class EventImageCleanupLogEvents
{
    public static readonly EventId ObjectDeleteFailed = new(5901, "EventImageObjectDeleteFailed");
    public static readonly EventId PostCommitCleanupFailed = new(5903, "EventImagePostCommitCleanupFailed");
    public static readonly EventId ProposalPostCommitCleanupFailed = new(5904, "EventImageProposalPostCommitCleanupFailed");
}
