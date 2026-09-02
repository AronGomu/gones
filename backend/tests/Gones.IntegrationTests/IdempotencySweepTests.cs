using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.IntegrationTests;

public sealed class IdempotencySweepTests : IAsyncLifetime
{
    private readonly PostgreSqlTestContainer postgres = new();
    private readonly MutableClock clock = new(Instant.FromUtc(2026, 8, 27, 12, 0));

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
    }

    public Task DisposeAsync() => postgres.DisposeAsync().AsTask();

    [Fact]
    public async Task Sweeper_deletes_expired_records_and_keeps_live_rows()
    {
        var now = clock.GetCurrentInstant();
        await using (var seed = CreateContext())
        {
            seed.IdempotencyRecords.AddRange(
                Record("expired", now - Duration.FromHours(1), now),
                Record("live", now + Duration.FromHours(1), now));
            await seed.SaveChangesAsync();
        }

        await using (var sweep = CreateContext())
        {
            Assert.Equal(1, await new IdempotencyRecordSweeper(sweep, clock).SweepBatchAsync(CancellationToken.None));
        }

        await using var verify = CreateContext();
        Assert.False(await verify.IdempotencyRecords.AnyAsync(item => item.Key == "expired"));
        Assert.True(await verify.IdempotencyRecords.AnyAsync(item => item.Key == "live"));
    }

    [Fact]
    public async Task Sweeper_returns_zero_when_nothing_is_expired()
    {
        var now = clock.GetCurrentInstant();
        await using (var seed = CreateContext())
        {
            seed.IdempotencyRecords.Add(Record("still-live", now + Duration.FromHours(1), now));
            await seed.SaveChangesAsync();
        }

        await using (var sweep = CreateContext())
        {
            Assert.Equal(0, await new IdempotencyRecordSweeper(sweep, clock).SweepBatchAsync(CancellationToken.None));
        }

        await using var verify = CreateContext();
        Assert.True(await verify.IdempotencyRecords.AnyAsync(item => item.Key == "still-live"));
    }

    private static IdempotencyRecord Record(string key, Instant expiresAt, Instant createdAt) => new()
    {
        Scope = "sweep-test",
        Key = key,
        ResponseStatusCode = 200,
        ResponseBody = "{}",
        CreatedAt = createdAt,
        ExpiresAt = expiresAt
    };

    private GonesDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options);

    private sealed class MutableClock(Instant current) : IClock
    {
        public Instant GetCurrentInstant() => current;
        public void Advance(Duration duration) => current += duration;
    }
}
