using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Domain.Identity;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

namespace Gones.IntegrationTests;

public sealed partial class OwnerSetupTests
{
    [Fact]
    public async Task Invalid_domain_profile_returns_field_error_without_mutation_and_same_token_can_retry()
    {
        await using var db = Db();
        Assert.True((await IssueAsync(db)).Enqueued);
        var token = await TokenAsync();
        var before = await db.OwnerSetups.AsNoTracking().SingleAsync();
        var auditCount = await db.AuditRecords.CountAsync();
        using var invalid = await client.PostAsJsonAsync("/api/auth/owner-setup", new
        {
            token, password = Password, username = " OwnerFixture", firstName = "Fixture", lastName = "Owner"
        });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        var problem = await invalid.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains(problem.GetProperty("errors").EnumerateObject(), field =>
            field.Name.Equals("username", StringComparison.OrdinalIgnoreCase) && field.Value.GetArrayLength() > 0);
        Assert.Empty(await db.Users.AsNoTracking().ToListAsync());
        Assert.Empty(await db.UserProfiles.AsNoTracking().ToListAsync());
        Assert.Equal(auditCount, await db.AuditRecords.CountAsync());
        AssertPendingUnchanged(before, await db.OwnerSetups.AsNoTracking().SingleAsync());
        using var corrected = await client.PostAsJsonAsync("/api/auth/owner-setup", Request(token));
        Assert.Equal(HttpStatusCode.NoContent, corrected.StatusCode);
        Assert.Single(await db.Users.AsNoTracking().ToListAsync());
        Assert.Single(await db.UserProfiles.AsNoTracking().ToListAsync());
        Assert.Single(await db.AuditRecords.Where(record => record.Action == "owner.setup.completed").ToListAsync());
    }

    [Theory]
    [InlineData("owner")]
    [InlineData("admin")]
    public async Task Both_actual_promotion_commands_refuse_pending_verified_password_collision_without_authority_changes(string command)
    {
        await using var db = Db();
        Assert.True((await IssueAsync(db)).Enqueued);
        using var registered = await RegisterAsync();
        Assert.Equal(HttpStatusCode.Accepted, registered.StatusCode);
        using var verified = await client.PostAsJsonAsync("/api/auth/verify-email", new { token = await OrdinaryTokenAsync("verify-email") });
        Assert.Equal(HttpStatusCode.NoContent, verified.StatusCode);
        using var login = await client.PostAsJsonAsync("/api/auth/login", new { email = Owner, password = Password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var before = await db.Users.AsNoTracking().SingleAsync();
        Assert.True(before.EmailConfirmed);
        Assert.NotNull(before.PasswordHash);
        Assert.Empty(await db.SystemMarkers.AsNoTracking().ToListAsync());
        var sessions = await db.RefreshSessions.AsNoTracking().OrderBy(session => session.Id).ToListAsync();
        Assert.NotEmpty(sessions);
        var audits = await db.AuditRecords.Select(record => record.Id).OrderBy(id => id).ToListAsync();
        var result = command == "owner" ? await CliAsync("owner", "promote") : await CliAsync("admin", "bootstrap", "--email", Owner);
        Assert.NotEqual(0, result.ExitCode);
        var after = await db.Users.AsNoTracking().SingleAsync();
        Assert.Equal(before.Id, after.Id);
        Assert.Equal(GlobalRoles.User, after.GlobalRole);
        Assert.True(before.PasswordHash == after.PasswordHash);
        Assert.True(before.SecurityStamp == after.SecurityStamp);
        Assert.True(before.ConcurrencyStamp == after.ConcurrencyStamp);
        Assert.True(JsonSerializer.Serialize(sessions) == JsonSerializer.Serialize(await db.RefreshSessions.AsNoTracking().OrderBy(session => session.Id).ToListAsync()));
        Assert.Equal(audits, await db.AuditRecords.Select(record => record.Id).OrderBy(id => id).ToListAsync());
        // Initializing an unconsumed marker with the terminal disable is not promotion authority.
        Assert.All(await db.SystemMarkers.AsNoTracking().ToListAsync(), marker => Assert.Null(marker.ConsumedAt));
        Assert.False(await db.AuditRecords.AnyAsync(record => record.Action == "admin.bootstrap.promoted"));
        var setup = await db.OwnerSetups.AsNoTracking().SingleAsync();
        Assert.False(setup.Enabled);
        Assert.Null(setup.CompletedAt);
    }

    [Fact]
    public async Task Migration_disabled_unbound_owner_promote_refuses_but_owner_only_legacy_config_promotes()
    {
        await using var upgraded = new PostgreSqlTestContainer();
        await upgraded.StartAsync();
        await using var db = new GonesDbContext(new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(upgraded.GetConnectionString()).Options);
        await db.GetService<IMigrator>().MigrateAsync("20260909214025_WorkerMaintenance");
        var now = SystemClock.Instance.GetCurrentInstant();
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(), Email = Owner, NormalizedEmail = Owner.ToUpperInvariant(), EmailConfirmed = true,
            UserName = "LegacyOwner", NormalizedUserName = "LEGACYOWNER", SecurityStamp = Guid.NewGuid().ToString("N")
        };
        user.PasswordHash = new PasswordHasher<ApplicationUser>().HashPassword(user, Password);
        var passwordHash = user.PasswordHash;
        var token = AccountActionToken.Create(user.Id, AccountActionPurpose.ResetPassword, new string('a', 64), user.SecurityStamp, null, null, now);
        db.Users.Add(user);
        db.UserProfiles.Add(UserProfile.Create(user.Id, user.UserName, "Fixture", "Owner", now));
        db.AccountActionTokens.Add(token);
        await db.SaveChangesAsync();
        await db.Database.MigrateAsync();
        var setup = await db.OwnerSetups.AsNoTracking().SingleAsync();
        Assert.False(setup.Enabled);
        Assert.Null(setup.OwnerEmail);
        Assert.Null(setup.UserId);
        Assert.False(db.Database.HasPendingModelChanges());
        var settings = new Dictionary<string, string?> { ["GONES_DB_CONNECTION"] = upgraded.GetConnectionString() };
        // Full setup config makes this a real unbound-state refusal, not a missing-config refusal.
        Assert.NotEqual(0, (await CliWithSettingsAsync(settings, "owner", "promote")).ExitCode);
        Assert.Empty(await db.SystemMarkers.AsNoTracking().ToListAsync());
        Assert.Equal(GlobalRoles.User, (await db.Users.AsNoTracking().SingleAsync()).GlobalRole);
        settings["GONES_DEPLOYMENT_ENVIRONMENT"] = null;
        settings["GONES_PUBLIC_APP_ORIGIN"] = null;
        Assert.Equal(0, (await CliWithSettingsAsync(settings, "admin", "bootstrap", "--email", Owner)).ExitCode);
        var promoted = await db.Users.AsNoTracking().SingleAsync();
        Assert.Equal(user.Id, promoted.Id);
        Assert.Equal(GlobalRoles.Admin, promoted.GlobalRole);
        Assert.True(promoted.EmailConfirmed);
        Assert.True(passwordHash == promoted.PasswordHash);
        Assert.Single(await db.UserProfiles.AsNoTracking().ToListAsync());
        Assert.Equal(token.Id, (await db.AccountActionTokens.AsNoTracking().SingleAsync()).Id);
        Assert.Single(await db.SystemMarkers.Where(marker => marker.ConsumedAt != null).ToListAsync());
        Assert.Single(await db.AuditRecords.Where(record => record.Action == "admin.bootstrap.promoted").ToListAsync());
        var after = await db.OwnerSetups.AsNoTracking().SingleAsync();
        Assert.False(after.Enabled);
        Assert.Null(after.OwnerEmail);
        Assert.Null(after.CompletedAt);
    }

    [Theory]
    [InlineData("verify-email", AccountActionPurpose.VerifyEmail)]
    [InlineData("reset-password", AccountActionPurpose.ResetPassword)]
    public async Task Genuine_ordinary_purpose_token_is_rejected_without_disqualifying_pending_setup(string template, AccountActionPurpose purpose)
    {
        await using var db = Db();
        Assert.True((await IssueAsync(db)).Enqueued);
        var setupToken = await TokenAsync();
        var before = await db.OwnerSetups.AsNoTracking().SingleAsync();
        var auditCount = await db.AuditRecords.CountAsync();
        var mailCount = await db.NotificationOutboxRecords.CountAsync();
        // AccountActionToken requires a user FK. Issue genuine tokens in a separate DB, never weaken target freshness.
        await using var ordinary = new PostgreSqlTestContainer();
        await ordinary.StartAsync();
        await using var ordinaryDb = new GonesDbContext(new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(ordinary.GetConnectionString()).Options);
        await ordinaryDb.Database.MigrateAsync();
        await using var ordinaryFactory = Factory().WithWebHostBuilder(builder => builder.UseSetting("GONES_DB_CONNECTION", ordinary.GetConnectionString()));
        using var ordinaryHttp = ordinaryFactory.CreateClient();
        using var registered = await ordinaryHttp.PostAsJsonAsync("/api/auth/register", new
        {
            email = Owner, username = "OrdinaryOwner", password = Password, firstName = "Fixture", lastName = "Owner"
        });
        Assert.Equal(HttpStatusCode.Accepted, registered.StatusCode);
        async Task<string> ReadTokenAsync(string key)
        {
            var model = await ordinaryDb.NotificationOutboxRecords.Where(record => record.TemplateKey == key)
                .OrderByDescending(record => record.CreatedAt).Select(record => record.TemplateModelJson).FirstAsync();
            using var json = JsonDocument.Parse(model!);
            return System.Web.HttpUtility.ParseQueryString(new Uri(json.RootElement.GetProperty("actionUrl").GetString()!).Query)["token"]!;
        }
        if (purpose == AccountActionPurpose.ResetPassword)
        {
            using var verified = await ordinaryHttp.PostAsJsonAsync("/api/auth/verify-email", new { token = await ReadTokenAsync("verify-email") });
            Assert.Equal(HttpStatusCode.NoContent, verified.StatusCode);
            using var forgot = await ordinaryHttp.PostAsJsonAsync("/api/auth/forgot-password", new { email = Owner });
            Assert.Equal(HttpStatusCode.Accepted, forgot.StatusCode);
        }
        var ordinaryToken = await ReadTokenAsync(template);
        var sourceToken = await ordinaryDb.AccountActionTokens.AsNoTracking().SingleAsync(record => record.Purpose == purpose);
        var sourceUser = await ordinaryDb.Users.AsNoTracking().SingleAsync();
        Assert.True(sourceToken.CanConsume(SystemClock.Instance.GetCurrentInstant(), sourceUser.SecurityStamp!));
        using var refused = await client.PostAsJsonAsync("/api/auth/owner-setup", Request(ordinaryToken));
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        var problem = await refused.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("invalid_account_action", problem.GetProperty("code").GetString());
        Assert.Empty(await db.Users.AsNoTracking().ToListAsync());
        Assert.Empty(await db.UserProfiles.AsNoTracking().ToListAsync());
        Assert.Empty(await db.AccountActionTokens.AsNoTracking().ToListAsync());
        Assert.Equal(auditCount, await db.AuditRecords.CountAsync());
        Assert.Equal(mailCount, await db.NotificationOutboxRecords.CountAsync());
        AssertPendingUnchanged(before, await db.OwnerSetups.AsNoTracking().SingleAsync());
        using var sourceConsumed = purpose == AccountActionPurpose.VerifyEmail
            ? await ordinaryHttp.PostAsJsonAsync("/api/auth/verify-email", new { token = ordinaryToken })
            : await ordinaryHttp.PostAsJsonAsync("/api/auth/reset-password", new { token = ordinaryToken, password = "another-owner-chosen-fixture-password" });
        Assert.Equal(HttpStatusCode.NoContent, sourceConsumed.StatusCode);
        using var completed = await client.PostAsJsonAsync("/api/auth/owner-setup", Request(setupToken));
        Assert.Equal(HttpStatusCode.NoContent, completed.StatusCode);
    }

    private static void AssertPendingUnchanged(OwnerSetup before, OwnerSetup after)
    {
        Assert.True(after.Enabled);
        Assert.Null(after.CompletedAt);
        Assert.Equal(before.Key, after.Key);
        Assert.Equal(before.UserId, after.UserId);
        Assert.True(before.OwnerEmail == after.OwnerEmail);
        Assert.Equal(before.Environment, after.Environment);
        Assert.Equal(before.PublicOrigin, after.PublicOrigin);
        Assert.True(before.TokenHash == after.TokenHash);
        Assert.Equal(before.IssuedAt, after.IssuedAt);
        Assert.Equal(before.ExpiresAt, after.ExpiresAt);
    }
}
