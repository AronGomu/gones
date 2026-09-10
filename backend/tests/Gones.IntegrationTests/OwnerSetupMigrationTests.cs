using Gones.Domain.Identity;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

namespace Gones.IntegrationTests;

public sealed class OwnerSetupMigrationTests : IAsyncLifetime
{
    private readonly PostgreSqlTestContainer postgres = new();
    public Task InitializeAsync() => postgres.StartAsync();
    public Task DisposeAsync() => postgres.DisposeAsync().AsTask();

    [Fact]
    public async Task Populated_current_head_upgrade_preserves_users_profiles_and_existing_action_tokens()
    {
        await using var db = new GonesDbContext(new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options);
        await db.GetService<IMigrator>().MigrateAsync("20260909214025_WorkerMaintenance");
        var now = SystemClock.Instance.GetCurrentInstant();
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(), Email = "existing@example.test", NormalizedEmail = "EXISTING@EXAMPLE.TEST",
            UserName = "ExistingFixture", NormalizedUserName = "EXISTINGFIXTURE", SecurityStamp = Guid.NewGuid().ToString("N")
        };
        user.PasswordHash = new PasswordHasher<ApplicationUser>().HashPassword(user, "existing-fixture-password");
        var passwordHash = user.PasswordHash;
        var token = AccountActionToken.Create(user.Id, AccountActionPurpose.VerifyEmail, new string('a', 64), user.SecurityStamp, null, null, now);
        db.Users.Add(user);
        db.UserProfiles.Add(UserProfile.Create(user.Id, user.UserName, "Existing", "Fixture", now));
        db.AccountActionTokens.Add(token);
        await db.SaveChangesAsync();
        await db.Database.MigrateAsync();
        db.ChangeTracker.Clear();
        Assert.False((await db.OwnerSetups.SingleAsync()).Enabled);
        var preserved = await db.Users.SingleAsync();
        Assert.Equal(user.Id, preserved.Id);
        Assert.True(passwordHash == preserved.PasswordHash);
        Assert.Equal(GlobalRoles.User, preserved.GlobalRole);
        Assert.Single(await db.UserProfiles.ToListAsync());
        var preservedToken = await db.AccountActionTokens.SingleAsync();
        Assert.Equal(token.Id, preservedToken.Id);
        Assert.True(preservedToken.CanConsume(now, preserved.SecurityStamp!));
        Assert.False(db.Database.HasPendingModelChanges());
    }
}
