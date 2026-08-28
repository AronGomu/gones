using Gones.Domain.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Infrastructure.Persistence;

public sealed class IdempotencyRecordSweeper(GonesDbContext database, IClock clock)
{
    public const int BatchSize = 500;

    public async Task<int> SweepBatchAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var records = await database.IdempotencyRecords
            .Where(item => item.ExpiresAt <= now)
            .OrderBy(item => item.ExpiresAt)
            .Take(BatchSize)
            .ToListAsync(cancellationToken);
        if (records.Count > 0) database.IdempotencyRecords.RemoveRange(records);

        var tickets = await database.ConsumedEventPreviewTickets
            .Where(item => item.ExpiresAt <= now)
            .OrderBy(item => item.ExpiresAt)
            .Take(BatchSize)
            .ToListAsync(cancellationToken);
        if (tickets.Count > 0) database.ConsumedEventPreviewTickets.RemoveRange(tickets);

        if (records.Count > 0 || tickets.Count > 0) await database.SaveChangesAsync(cancellationToken);
        return records.Count + tickets.Count;
    }
}
