using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Infrastructure.Observability;

public sealed class WorkerHeartbeatStore(GonesDbContext database, IClock clock)
{
    public Task RecordAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        return database.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO worker_heartbeats (worker_id, last_seen_at)
            VALUES ({WorkerHeartbeatRecord.NotificationWorkerId}, {now})
            ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
            """, cancellationToken);
    }
}
