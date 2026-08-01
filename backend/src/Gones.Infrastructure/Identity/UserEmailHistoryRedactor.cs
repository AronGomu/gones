using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Infrastructure.Identity;

public sealed class UserEmailHistoryRedactor(GonesDbContext database, IClock clock)
{
    public const int BatchSize = 100;

    public async Task<int> RedactBatchAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var due = await database.UserEmailHistories
            .Where(history => history.Email != null && history.RetainUntil <= now)
            .OrderBy(history => history.RetainUntil)
            .ThenBy(history => history.Id)
            .Take(BatchSize)
            .ToListAsync(cancellationToken);
        foreach (var history in due) history.Redact(now);
        if (due.Count > 0) await database.SaveChangesAsync(cancellationToken);
        return due.Count;
    }
}
