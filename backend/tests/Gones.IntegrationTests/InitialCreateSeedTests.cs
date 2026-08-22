using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Gones.IntegrationTests;

/// <summary>
/// T1 squashed 35 migrations into one <c>InitialCreate</c>. EF's model diff regenerates tables,
/// columns, indexes and constraints, but never a seeded row: the fixed placeholder League lived in a
/// hand-written <c>InsertData</c> call and had to be carried across by hand. Nothing else asserted it
/// from a test — only <c>scripts/seed-local.mjs</c> did, and a script is not a gate the backend suite
/// runs. This test is that gate.
/// </summary>
public sealed class InitialCreateSeedTests : IAsyncLifetime
{
    private readonly PostgreSqlTestContainer postgres = new();

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
    }

    public Task DisposeAsync() => postgres.DisposeAsync().AsTask();

    [Fact]
    public async Task Initial_create_seeds_the_fixed_placeholder_league()
    {
        await using var database = CreateContext();

        var count = await database.Database.SqlQueryRaw<int>("""
            SELECT count(*)::int AS "Value"
            FROM league_archive_aggregates
            WHERE document_id = 'placeholder-league'
              AND name = 'Unassigned Tournaments'
              AND status = 'active'
              AND deleted_at IS NULL
              AND version = 1
              AND canonical_document ->> 'id' = 'placeholder-league'
              AND canonical_document -> 'tournaments' = '[]'::jsonb
            """).SingleAsync();

        Assert.Equal(1, count);
    }

    private GonesDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<GonesDbContext>()
            .ConfigureGones(postgres.GetConnectionString())
            .Options);
}
