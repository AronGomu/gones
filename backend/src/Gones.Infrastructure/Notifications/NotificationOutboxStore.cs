using Gones.Domain.Calendar;
using Gones.Domain.Notifications;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Infrastructure.Notifications;

public sealed class NotificationOutboxStore(GonesDbContext database, IClock clock)
{
    public async Task<IReadOnlyList<NotificationOutboxRecord>> ClaimAsync(
        int batchSize,
        Duration leaseDuration,
        CancellationToken cancellationToken)
    {
        if (batchSize is < 1 or > 100) throw new ArgumentOutOfRangeException(nameof(batchSize));
        var now = clock.GetCurrentInstant();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var records = await database.NotificationOutboxRecords
            .FromSqlInterpolated($"""
                SELECT *
                FROM notification_outbox
                WHERE (status = 'Pending' AND available_at <= {now})
                   OR (status = 'Sending' AND lease_expires_at <= {now})
                ORDER BY CASE WHEN status = 'Sending' THEN lease_expires_at ELSE available_at END, created_at, id
                FOR UPDATE SKIP LOCKED
                LIMIT {batchSize}
                """)
            .ToListAsync(cancellationToken);

        foreach (var record in records) record.Claim(now, leaseDuration);
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return records;
    }

    public void RecordSuccessful(NotificationOutboxRecord record, Instant sentAt)
    {
        ArgumentNullException.ThrowIfNull(record);
        database.NotificationHistory.Add(NotificationHistory.Successful(
            record.Id,
            record.TemplateKey,
            record.DedupeKey,
            record.UserId,
            record.TournamentId,
            sentAt));
    }

    public Task SaveAsync(CancellationToken cancellationToken) => database.SaveChangesAsync(cancellationToken);
}
