using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text.Json;
using Gones.Application.Notifications;
using Gones.Domain.Identity;
using Gones.Infrastructure.Configuration;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Persistence;
using Gones.Infrastructure.Workers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NodaTime;

namespace Gones.IntegrationTests;

public sealed partial class OwnerSetupTests
{
    [Fact]
    public async Task Promotion_failure_rolls_back_role_stamp_sessions_and_marker()
    {
        await using var db = Db();
        Assert.True((await IssueAsync(db)).Enqueued);
        using var completed = await client.PostAsJsonAsync("/api/auth/owner-setup", Request(await TokenAsync()));
        Assert.Equal(HttpStatusCode.NoContent, completed.StatusCode);
        using var login = await client.PostAsJsonAsync("/api/auth/login", new { email = Owner, password = Password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var before = await db.Users.AsNoTracking().SingleAsync();
        var sessions = await db.RefreshSessions.AsNoTracking().ToListAsync();
        await using var failing = new GonesDbContext(new DbContextOptionsBuilder<GonesDbContext>()
            .ConfigureGones(postgres.GetConnectionString()).AddInterceptors(new RejectPromotionCommit()).Options);
        var bootstrap = new AdminBootstrapService(failing, SystemClock.Instance, StagingAccessPolicy.Unrestricted, Configuration());
        await Assert.ThrowsAsync<InvalidOperationException>(() => bootstrap.BootstrapAsync(Owner, Owner, requireOwnerSetup: true));
        db.ChangeTracker.Clear();
        var after = await db.Users.SingleAsync();
        Assert.Equal(GlobalRoles.User, after.GlobalRole);
        Assert.True(before.SecurityStamp == after.SecurityStamp);
        Assert.True(before.PasswordHash == after.PasswordHash);
        Assert.All(await db.RefreshSessions.ToListAsync(), session => Assert.Null(session.RevokedAt));
        Assert.Equal(sessions.Count, await db.RefreshSessions.CountAsync());
        Assert.Empty(await db.SystemMarkers.ToListAsync());
        Assert.False(await db.AuditRecords.AnyAsync(record => record.Action == "admin.bootstrap.promoted"));
    }

    [Fact]
    public async Task Profile_insert_failure_rolls_back_created_identity_and_token_completion()
    {
        await using var db = Db();
        Assert.True((await IssueAsync(db)).Enqueued);
        var token = await TokenAsync();
        await db.Database.ExecuteSqlRawAsync("""
            CREATE FUNCTION s6_reject_profile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 's6_fixture_profile_failure'; END $$;
            CREATE TRIGGER s6_reject_profile BEFORE INSERT ON user_profiles FOR EACH ROW EXECUTE FUNCTION s6_reject_profile();
            """);
        using var failed = await client.PostAsJsonAsync("/api/auth/owner-setup", Request(token));
        Assert.Equal(HttpStatusCode.Conflict, failed.StatusCode);
        Assert.Empty(await db.Users.ToListAsync());
        Assert.Empty(await db.UserProfiles.ToListAsync());
        Assert.Null((await db.OwnerSetups.AsNoTracking().SingleAsync()).CompletedAt);
        await db.Database.ExecuteSqlRawAsync("DROP TRIGGER s6_reject_profile ON user_profiles; DROP FUNCTION s6_reject_profile();");
        using var retry = await client.PostAsJsonAsync("/api/auth/owner-setup", Request(token));
        Assert.Equal(HttpStatusCode.NoContent, retry.StatusCode);
    }

    [Fact]
    public async Task Completed_owner_cannot_rebind_and_demoted_or_deleted_owner_is_never_repromoted()
    {
        await using var db = Db();
        Assert.True((await IssueAsync(db)).Enqueued);
        using var completed = await client.PostAsJsonAsync("/api/auth/owner-setup", Request(await TokenAsync()));
        Assert.Equal(HttpStatusCode.NoContent, completed.StatusCode);
        Assert.NotEqual(0, (await CliWithSettingsAsync(new Dictionary<string, string?> { ["GONES_BOOTSTRAP_ADMIN_EMAIL"] = "changed@example.test" }, "owner", "promote")).ExitCode);
        Assert.Equal(0, (await CliAsync("owner", "promote")).ExitCode);
        var user = await db.Users.SingleAsync();
        user.AssignGlobalRole(GlobalRoles.User);
        await db.SaveChangesAsync();
        Assert.Equal(0, (await CliAsync("owner", "promote")).ExitCode);
        db.ChangeTracker.Clear();
        Assert.Equal(GlobalRoles.User, (await db.Users.SingleAsync()).GlobalRole);
        var userId = user.Id;
        await db.Database.ExecuteSqlInterpolatedAsync($"UPDATE audit_records SET actor_id = NULL WHERE actor_id = {userId}");
        db.ChangeTracker.Clear();
        await db.Users.Where(item => item.Id == userId).ExecuteDeleteAsync();
        Assert.Equal(0, (await CliAsync("owner", "promote")).ExitCode);
        Assert.Equal(0, (await CliAsync("admin", "bootstrap", "--email", Owner)).ExitCode);
        Assert.Equal(0, (await CliAsync("owner", "setup")).ExitCode);
        Assert.Empty(await db.Users.ToListAsync());
        Assert.NotNull((await db.OwnerSetups.AsNoTracking().SingleAsync()).CompletedAt);
        Assert.Single(await db.NotificationOutboxRecords.Where(record => record.TemplateKey == "owner-setup").ToListAsync());
    }

    [Fact]
    public async Task Legacy_passwordless_verified_account_cannot_be_promoted()
    {
        using var registered = await RegisterAsync();
        Assert.Equal(HttpStatusCode.Accepted, registered.StatusCode);
        await using var db = Db();
        var user = await db.Users.SingleAsync();
        user.EmailConfirmed = true;
        user.PasswordHash = null;
        await db.SaveChangesAsync();
        Assert.NotEqual(0, (await CliAsync("admin", "bootstrap", "--email", Owner)).ExitCode);
        db.ChangeTracker.Clear();
        Assert.Equal(GlobalRoles.User, (await db.Users.SingleAsync()).GlobalRole);
        Assert.False(await db.SystemMarkers.AnyAsync(marker => marker.ConsumedAt != null));
    }

    [Fact]
    public async Task Staging_cutoff_invalidates_setup_without_changing_ordinary_host_staging_config_contract()
    {
        var directory = ScratchDirectory();
        var policyFile = Path.Combine(directory, "policy.json");
        try
        {
            await using var db = Db();
            var issuedAt = Instant.FromUnixTimeSeconds(SystemClock.Instance.GetCurrentInstant().ToUnixTimeSeconds() - 300);
            var config = Configuration("staging");
            await File.WriteAllTextAsync(policyFile, JsonSerializer.Serialize(new
            {
                revision = "s6", validAfterUtc = issuedAt.ToString(), invitedEmails = new[] { Owner }, recipientEmails = new[] { Owner }
            }));
            var policyConfig = new Microsoft.Extensions.Configuration.ConfigurationBuilder().AddConfiguration(config)
                .AddInMemoryCollection(new Dictionary<string, string?> { [StagingAccessPolicy.FileKey] = policyFile }).Build();
            var policy = StagingAccessPolicy.Load(policyConfig, "Staging");
            var issuance = new OwnerSetupService(db, new NotificationOutbox(db, new FixedClock(issuedAt)), new FixedClock(issuedAt), policy);
            Assert.True((await issuance.IssueAsync(OwnerSetupOptions.Load(policyConfig), false)).Enqueued);
            var token = await TokenAsync();
            await File.WriteAllTextAsync(policyFile, JsonSerializer.Serialize(new
            {
                revision = "s6-next", validAfterUtc = (issuedAt + Duration.FromSeconds(1)).ToString(), invitedEmails = new[] { Owner }, recipientEmails = new[] { Owner }
            }));
            await using var staging = Factory(deployment: "staging").WithWebHostBuilder(builder => builder.UseSetting(StagingAccessPolicy.FileKey, policyFile));
            using var http = staging.CreateClient();
            using var rejected = await http.PostAsJsonAsync("/api/auth/owner-setup", Request(token));
            Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
            Assert.Empty(await db.Users.ToListAsync());
            var missingDeployment = new Dictionary<string, string?> { ["GONES_DEPLOYMENT_ENVIRONMENT"] = null };
            Assert.NotEqual(0, (await CliWithSettingsAsync(missingDeployment, "owner", "setup")).ExitCode);
        }
        finally { File.Delete(policyFile); Directory.Delete(directory); }
    }

    [Fact]
    public async Task Normalized_username_conflict_preserves_established_identity_and_disables_setup()
    {
        await using var db = Db();
        Assert.True((await IssueAsync(db)).Enqueued);
        var token = await TokenAsync();
        using var registration = await client.PostAsJsonAsync("/api/auth/register", new
        {
            email = "other@example.test", username = "ownerfixture", password = Password, firstName = "Existing", lastName = "Fixture"
        });
        Assert.Equal(HttpStatusCode.Accepted, registration.StatusCode);
        var before = await db.Users.AsNoTracking().SingleAsync();
        using var conflict = await client.PostAsJsonAsync("/api/auth/owner-setup", Request(token));
        Assert.Equal(HttpStatusCode.BadRequest, conflict.StatusCode);
        var after = await db.Users.AsNoTracking().SingleAsync();
        Assert.Equal(before.Id, after.Id);
        Assert.True(before.PasswordHash == after.PasswordHash);
        Assert.Single(await db.UserProfiles.ToListAsync());
        Assert.False((await db.OwnerSetups.AsNoTracking().SingleAsync()).Enabled);
        Assert.Null((await db.OwnerSetups.AsNoTracking().SingleAsync()).CompletedAt);
    }

    [Fact]
    public async Task Missing_explicit_setup_deployment_keeps_ordinary_api_auth_available()
    {
        await using var host = Factory().WithWebHostBuilder(builder => builder.UseSetting("GONES_DEPLOYMENT_ENVIRONMENT", ""));
        // Empty deployment is invalid for all processes by the pre-existing staging policy contract.
        Assert.Throws<InvalidOperationException>(() => host.CreateClient());
        await using var compatible = new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_FEATURES:AUTH_V1", "true");
            builder.UseSetting("GONES_AUTH_PROVIDER", "Local");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "s6-fixture-signing-key-at-least-32-characters");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            builder.UseSetting("GONES_BOOTSTRAP_ADMIN_EMAIL", Owner);
        });
        using var http = compatible.CreateClient();
        using var setup = await http.PostAsJsonAsync("/api/auth/owner-setup", Request("invalid"));
        Assert.Equal(HttpStatusCode.BadRequest, setup.StatusCode);
        using var login = await http.PostAsJsonAsync("/api/auth/login", new { email = Owner, password = Password });
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
    }

    [Fact]
    public async Task Public_validation_rate_limit_applies_without_consuming_token()
    {
        await using var db = Db();
        Assert.True((await IssueAsync(db)).Enqueued);
        await using var limited = Factory().WithWebHostBuilder(builder => builder.UseSetting("GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT", "1"));
        using var http = limited.CreateClient();
        using var first = await http.PostAsJsonAsync("/api/auth/owner-setup", Request("invalid"));
        using var second = await http.PostAsJsonAsync("/api/auth/owner-setup", Request("invalid"));
        Assert.Equal(HttpStatusCode.BadRequest, first.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, second.StatusCode);
        Assert.Null((await db.OwnerSetups.AsNoTracking().SingleAsync()).CompletedAt);
    }

    [Fact]
    public async Task Cli_wake_observes_committed_issuance_and_failed_wake_preserves_pending()
    {
        if (!OperatingSystem.IsLinux()) throw new InvalidOperationException("S6 wake acceptance requires Linux.");
        var directory = ScratchDirectory();
        var path = Path.Combine(directory, "wake");
        var settings = new Dictionary<string, string?> { ["GONES_WORKER_WAKE_SOCKET"] = path, ["GONES_WORKER_WAKE_TOKEN"] = new string('a', 64) };
        try
        {
            using (var listener = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified))
            {
                listener.Bind(new UnixDomainSocketEndPoint(path));
                File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
                listener.Listen(1);
                var command = CliWithSettingsAsync(settings, "owner", "setup");
                using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                using var accepted = await listener.AcceptAsync(deadline.Token);
                using var stream = new NetworkStream(accepted);
                await stream.ReadExactlyAsync(new byte[WorkerWakeProtocol.RequestLength], deadline.Token);
                await using var db = Db();
                Assert.Single(await db.NotificationOutboxRecords.ToListAsync());
                Assert.NotNull((await db.OwnerSetups.SingleAsync()).IssuedAt);
                await stream.WriteAsync(WorkerWakeProtocol.Acknowledgement.ToArray(), deadline.Token);
                accepted.Shutdown(SocketShutdown.Send);
                Assert.Equal(0, (await command).ExitCode);
            }
            File.Delete(path);
            await using (var db = Db()) await db.Database.ExecuteSqlRawAsync("UPDATE owner_setups SET issued_at = now() - interval '2 hours'");
            var failedWake = await CliWithSettingsAsync(settings, "owner", "resend");
            Assert.Equal(0, failedWake.ExitCode);
            Assert.Contains("owner_setup_pending", failedWake.Output, StringComparison.Ordinal);
            Assert.Contains("worker.wake.failed", failedWake.Output, StringComparison.Ordinal);
            await using var read = Db();
            Assert.Equal(2, await read.NotificationOutboxRecords.CountAsync());
        }
        finally { if (File.Exists(path)) File.Delete(path); Directory.Delete(directory); }
    }

    [Fact]
    public async Task Cli_issuance_rollback_emits_no_wake_and_retains_no_generation()
    {
        if (!OperatingSystem.IsLinux()) throw new InvalidOperationException("S6 wake acceptance requires Linux.");
        await using var db = Db();
        await db.Database.ExecuteSqlRawAsync("""
            CREATE FUNCTION s6_reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 's6_fixture_outbox_failure'; END $$;
            CREATE TRIGGER s6_reject_outbox BEFORE INSERT ON notification_outbox FOR EACH ROW EXECUTE FUNCTION s6_reject_outbox();
            """);
        var directory = ScratchDirectory();
        var path = Path.Combine(directory, "wake");
        try
        {
            using var listener = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
            listener.Bind(new UnixDomainSocketEndPoint(path));
            File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            listener.Listen(1);
            var result = await CliWithSettingsAsync(new Dictionary<string, string?> { ["GONES_WORKER_WAKE_SOCKET"] = path, ["GONES_WORKER_WAKE_TOKEN"] = new string('a', 64) }, "owner", "setup");
            Assert.NotEqual(0, result.ExitCode);
            Assert.False(listener.Poll(100_000, SelectMode.SelectRead));
            Assert.Empty(await db.NotificationOutboxRecords.ToListAsync());
            Assert.Null((await db.OwnerSetups.SingleAsync()).IssuedAt);
            Assert.Null((await db.OwnerSetups.SingleAsync()).OwnerEmail);
        }
        finally { if (File.Exists(path)) File.Delete(path); Directory.Delete(directory); }
    }

    [Fact]
    public async Task Concurrent_private_resends_rotate_once_and_expiry_boundary_is_exclusive()
    {
        await using var db = Db();
        Assert.True((await IssueAsync(db)).Enqueued);
        var old = await TokenAsync();
        var setup = await db.OwnerSetups.AsNoTracking().SingleAsync();
        Assert.False(setup.CanComplete(old, setup.ExpiresAt!.Value));
        Assert.True(setup.CanComplete(old, setup.ExpiresAt.Value - Duration.FromMilliseconds(1)));
        await db.Database.ExecuteSqlRawAsync("UPDATE owner_setups SET issued_at = now() - interval '2 hours'");
        var results = await Task.WhenAll(CliAsync("owner", "resend"), CliAsync("owner", "resend"));
        Assert.Single(results, result => result.ExitCode == 0);
        Assert.Single(results, result => result.ExitCode != 0);
        Assert.Equal(2, await db.NotificationOutboxRecords.CountAsync());
        using var superseded = await client.PostAsJsonAsync("/api/auth/owner-setup", Request(old));
        Assert.Equal(HttpStatusCode.BadRequest, superseded.StatusCode);
        using var accepted = await client.PostAsJsonAsync("/api/auth/owner-setup", Request(await TokenAsync()));
        Assert.Equal(HttpStatusCode.NoContent, accepted.StatusCode);
    }

    [Fact]
    public async Task Worker_file_delivery_contains_private_link_then_scrubs_outbox_and_previews()
    {
        var directory = ScratchDirectory();
        try
        {
            await using var db = Db();
            Assert.True((await IssueAsync(db)).Enqueued);
            var token = await TokenAsync();
            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["GONES_EMAIL_TRANSPORT"] = "File", ["GONES_EMAIL_SINK_PATH"] = directory,
                ["GONES_EMAIL_SINK_INCLUDE_ACTION_LINKS"] = "true", ["GONES_DEPLOYMENT_ENVIRONMENT"] = "testing"
            }).Build();
            var services = new ServiceCollection();
            services.AddLogging();
            services.AddGonesPersistence(postgres.GetConnectionString());
            services.AddNotificationWorker(config);
            using var provider = services.BuildServiceProvider();
            using var scope = provider.CreateScope();
            Assert.Equal(1, await scope.ServiceProvider.GetRequiredService<NotificationProcessor>().ProcessBatchAsync(CancellationToken.None));
            var path = Assert.Single(Directory.GetFiles(directory));
            var delivered = await File.ReadAllTextAsync(path);
            Assert.True(delivered.Contains(token, StringComparison.Ordinal), "Private delivery fixture must contain its link.");
            if (!OperatingSystem.IsWindows()) Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(path));
            db.ChangeTracker.Clear();
            var mail = await db.NotificationOutboxRecords.SingleAsync();
            Assert.Null(mail.TemplateModelJson);
            Assert.Null(mail.Recipient);
            Assert.Equal(Gones.Domain.Notifications.NotificationOutboxStatus.Sent, mail.Status);
            var renderer = new NotificationTemplateRenderer();
            var model = new OwnerSetupTemplateModel(new Uri("https://app.example/owner-setup#token=" + token));
            foreach (var locale in new[] { "fr", "en" })
            {
                var rendered = renderer.Render(locale, model);
                Assert.False(rendered.SafePreviewHtmlBody.Contains(token, StringComparison.Ordinal));
                Assert.False(rendered.SafePreviewTextBody.Contains(token, StringComparison.Ordinal));
            }
            Assert.All(await db.AuditRecords.ToListAsync(), audit => Assert.False(audit.RedactedDiff.Contains(token, StringComparison.Ordinal)));
        }
        finally
        {
            foreach (var file in Directory.GetFiles(directory)) File.Delete(file);
            Directory.Delete(directory);
        }
    }

    private static string ScratchDirectory()
    {
        var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", ".."));
        var directory = Path.Combine(root, ".tmp", "s6-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(directory);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        return directory;
    }

    private sealed class RejectPromotionCommit : DbTransactionInterceptor
    {
        public override ValueTask<InterceptionResult> TransactionCommittingAsync(DbTransaction transaction, TransactionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("s6_fixture_commit_failure");
    }
}
