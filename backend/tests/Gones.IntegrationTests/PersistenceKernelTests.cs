using Gones.Domain.Persistence;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using NodaTime;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Gones.IntegrationTests;

public sealed class PersistenceKernelTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder().WithImage("postgres:17-alpine").Build();

    public Task InitializeAsync() => postgres.StartAsync();

    public Task DisposeAsync() => postgres.DisposeAsync().AsTask();

    [Fact]
    public async Task Migrations_apply_from_empty_and_round_trip_to_empty()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        Assert.Contains(await db.Database.GetAppliedMigrationsAsync(), migration => migration.EndsWith("_InitialPersistence", StringComparison.Ordinal));
        Assert.Equal("uuid", await ScalarAsync(db, "SELECT data_type FROM information_schema.columns WHERE table_name = 'schema_versions' AND column_name = 'id'"));
        Assert.Equal("timestamp with time zone", await ScalarAsync(db, "SELECT data_type FROM information_schema.columns WHERE table_name = 'schema_versions' AND column_name = 'applied_at'"));
        Assert.Equal("jsonb", await ScalarAsync(db, "SELECT udt_name FROM information_schema.columns WHERE table_name = 'idempotency_records' AND column_name = 'response_body'"));
        Assert.Contains("UNIQUE", await ScalarAsync(db, "SELECT indexdef FROM pg_indexes WHERE tablename = 'idempotency_records' AND indexdef LIKE '%scope%key%'"), StringComparison.Ordinal);
        Assert.Contains("version > 0", await ScalarAsync(db, "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_version_positive' AND conrelid = 'schema_versions'::regclass"), StringComparison.Ordinal);
        var constraintError = await Assert.ThrowsAsync<PostgresException>(() => db.Database.ExecuteSqlRawAsync("INSERT INTO schema_versions (id, version, name, applied_at) VALUES (gen_random_uuid(), -1, 'invalid', now())"));
        Assert.Equal(PostgresErrorCodes.CheckViolation, constraintError.SqlState);

        await db.Database.MigrateAsync("0");
        Assert.Empty(await db.Database.GetAppliedMigrationsAsync());

        await db.Database.MigrateAsync();
        Assert.Contains(await db.Database.GetAppliedMigrationsAsync(), migration => migration.EndsWith("_InitialPersistence", StringComparison.Ordinal));
    }

    [Fact]
    public void Persistence_registration_exposes_utc_clock()
    {
        var services = new ServiceCollection();
        services.AddGonesPersistence(postgres.GetConnectionString());
        using var provider = services.BuildServiceProvider();

        var clock = provider.GetRequiredService<IClock>();

        Assert.Same(SystemClock.Instance, clock);
        Assert.Equal(DateTimeZone.Utc, clock.GetCurrentInstant().InUtc().Zone);
    }

    [Fact]
    public async Task Uuid_keys_and_utc_instants_round_trip()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var appliedAt = Instant.FromUtc(2026, 7, 24, 10, 0);
        var row = new SchemaVersion { Name = $"test-{Guid.NewGuid():N}", AppliedAt = appliedAt };

        db.SchemaVersions.Add(row);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var persisted = await db.SchemaVersions.SingleAsync(item => item.Id == row.Id);
        Assert.NotEqual(Guid.Empty, persisted.Id);
        Assert.Equal(appliedAt, persisted.AppliedAt);
        Assert.Equal(1, persisted.Version);
    }

    [Fact]
    public async Task Idempotency_scope_and_key_are_unique()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var now = SystemClock.Instance.GetCurrentInstant();
        db.IdempotencyRecords.AddRange(
            new IdempotencyRecord { Scope = "test", Key = "same", ResponseStatusCode = 200, ResponseBody = "{}", CreatedAt = now, ExpiresAt = now + Duration.FromHours(1) },
            new IdempotencyRecord { Scope = "test", Key = "same", ResponseStatusCode = 200, ResponseBody = "{}", CreatedAt = now, ExpiresAt = now + Duration.FromHours(1) });

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Transaction_rollback_leaves_no_rows()
    {
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var id = Guid.NewGuid();
        await using (var transaction = await db.Database.BeginTransactionAsync())
        {
            db.OutboxRecords.Add(NewOutbox(id));
            await db.SaveChangesAsync();
            await transaction.RollbackAsync();
        }

        db.ChangeTracker.Clear();
        Assert.False(await db.OutboxRecords.AnyAsync(item => item.Id == id));
    }

    [Fact]
    public async Task Synchronous_save_increments_version()
    {
        var id = Guid.NewGuid();
        await using var db = CreateContext();
        await db.Database.MigrateAsync();
        var row = NewOutbox(id);
        db.OutboxRecords.Add(row);
        db.SaveChanges();

        row.AttemptCount = 1;
        db.SaveChanges();

        Assert.Equal(2, row.Version);
    }

    [Fact]
    public async Task Version_overflow_is_rejected_before_write()
    {
        await using var db = CreateContext();
        var row = NewOutbox(Guid.NewGuid());
        db.Attach(row);
        var entry = db.Entry(row);
        entry.State = EntityState.Modified;
        entry.Property(item => item.Version).OriginalValue = long.MaxValue;

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());

        Assert.Equal("Entity version overflow.", error.Message);
    }

    [Fact]
    public async Task Version_increments_and_rejects_stale_updates()
    {
        var id = Guid.NewGuid();
        await using (var seed = CreateContext())
        {
            await seed.Database.MigrateAsync();
            seed.OutboxRecords.Add(NewOutbox(id));
            await seed.SaveChangesAsync();
        }

        await using var first = CreateContext();
        await using var stale = CreateContext();
        var firstCopy = await first.OutboxRecords.SingleAsync(item => item.Id == id);
        var staleCopy = await stale.OutboxRecords.SingleAsync(item => item.Id == id);

        firstCopy.AttemptCount = 1;
        await first.SaveChangesAsync();
        Assert.Equal(2, firstCopy.Version);

        staleCopy.AttemptCount = 2;
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => stale.SaveChangesAsync());
    }

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>()
            .ConfigureGones(postgres.GetConnectionString())
            .Options;
        return new GonesDbContext(options);
    }

    private static async Task<string> ScalarAsync(GonesDbContext db, string sql)
    {
        await db.Database.OpenConnectionAsync();
        await using var command = db.Database.GetDbConnection().CreateCommand();
        command.CommandText = sql;
        return Convert.ToString(await command.ExecuteScalarAsync(), System.Globalization.CultureInfo.InvariantCulture)
            ?? throw new InvalidOperationException($"Query returned null: {sql}");
    }

    private static OutboxRecord NewOutbox(Guid id) => new()
    {
        Id = id,
        MessageType = "test",
        Payload = "{}",
        OccurredAt = SystemClock.Instance.GetCurrentInstant()
    };
}
