using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Domain.Identity;
using Gones.Infrastructure.Persistence;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Configuration;
using Gones.Infrastructure.Notifications;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NodaTime;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;

namespace Gones.IntegrationTests;

public sealed partial class OwnerSetupTests : IAsyncLifetime
{
    private const string Owner = "owner@example.test";
    private const string Password = "owner-chosen-fixture-password";
    private readonly PostgreSqlTestContainer postgres = new();
    private WebApplicationFactory<Program> factory = null!;
    private HttpClient client = null!;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var db = Db()) await db.Database.MigrateAsync();
        factory = Factory();
        client = factory.CreateClient();
    }

    public async Task DisposeAsync()
    {
        client.Dispose();
        await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Missing_owner_setup_configuration_fails_closed_without_breaking_ordinary_auth()
    {
        await using var absent = Factory(owner: null);
        using var http = absent.CreateClient();
        using var response = await http.PostAsJsonAsync("/api/auth/owner-setup", Request("invalid"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var login = await http.PostAsJsonAsync("/api/auth/login", new { email = Owner, password = Password });
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
        await using var db = Db();
        Assert.Empty(await db.Users.ToListAsync());
    }

    [Fact]
    public async Task Pending_setup_cannot_be_bypassed_by_legacy_promotion_of_an_ordinary_verified_account()
    {
        await using var db = Db();
        var issued = await IssueAsync(db);
        Assert.True(issued.Enqueued);
        using var registration = await RegisterAsync();
        Assert.Equal(HttpStatusCode.Accepted, registration.StatusCode);
        var user = await db.Users.SingleAsync();
        user.EmailConfirmed = true;
        await db.SaveChangesAsync();
        using var provider = PromotionProvider();
        using var scope = provider.CreateScope();
        var bootstrap = scope.ServiceProvider.GetRequiredService<AdminBootstrapService>();
        await Assert.ThrowsAsync<InvalidOperationException>(() => bootstrap.BootstrapAsync(Owner, Owner));
        db.ChangeTracker.Clear();
        Assert.Equal(GlobalRoles.User, (await db.Users.SingleAsync()).GlobalRole);
        Assert.False(await db.SystemMarkers.AnyAsync(marker => marker.ConsumedAt != null));
    }

    [Fact]
    public async Task Fresh_database_owner_password_verification_private_promotion_login_and_refresh_are_complete()
    {
        Assert.Equal(0, (await CliAsync("owner", "setup")).ExitCode);
        var token = await TokenAsync();
        await using var db = Db();
        Assert.Empty(await db.Users.ToListAsync());
        Assert.Empty(await db.UserProfiles.ToListAsync());
        Assert.Empty(await db.Events.ToListAsync());
        Assert.Empty(await db.ArchiveTournaments.ToListAsync());
        using var scanner = await client.GetAsync("/api/auth/owner-setup");
        Assert.Equal(HttpStatusCode.MethodNotAllowed, scanner.StatusCode);
        Assert.Null((await db.OwnerSetups.SingleAsync()).CompletedAt);
        using var completed = await client.PostAsJsonAsync("/api/auth/owner-setup", Request(token));
        Assert.Equal(HttpStatusCode.NoContent, completed.StatusCode);
        Assert.False(completed.Headers.Contains("Set-Cookie"));
        db.ChangeTracker.Clear();
        var user = await db.Users.SingleAsync();
        Assert.True(user.EmailConfirmed);
        Assert.Equal(GlobalRoles.User, user.GlobalRole);
        Assert.False(string.IsNullOrEmpty(user.PasswordHash));
        Assert.False(user.PasswordHash == Password);
        var profile = await db.UserProfiles.SingleAsync();
        Assert.Equal("OwnerFixture", profile.Username);
        Assert.False(profile.IsFirstNamePublic);
        using var beforeLogin = await client.PostAsJsonAsync("/api/auth/login", new { email = Owner, password = Password });
        var before = (await beforeLogin.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
        using var noAdmin = await AuthorizedAsync("/api/_contract/admin", before);
        Assert.Equal(HttpStatusCode.Forbidden, noAdmin.StatusCode);
        using var replay = await client.PostAsJsonAsync("/api/auth/owner-setup", Request(token));
        Assert.Equal(HttpStatusCode.BadRequest, replay.StatusCode);
        var promotions = await Task.WhenAll(CliAsync("owner", "promote"), CliAsync("admin", "bootstrap", "--email", Owner));
        Assert.All(promotions, result => Assert.Equal(0, result.ExitCode));
        db.ChangeTracker.Clear();
        Assert.Equal(GlobalRoles.Admin, (await db.Users.SingleAsync()).GlobalRole);
        Assert.Single(await db.AuditRecords.Where(record => record.Action == "admin.bootstrap.promoted").ToListAsync());
        Assert.Single(await db.SystemMarkers.Where(marker => marker.ConsumedAt != null).ToListAsync());
        using var stale = await AuthorizedAsync("/api/_contract/admin", before);
        Assert.Equal(HttpStatusCode.Unauthorized, stale.StatusCode);
        using var login = await client.PostAsJsonAsync("/api/auth/login", new { email = Owner, password = Password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var access = (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
        using var admin = await AuthorizedAsync("/api/admin/users", access);
        Assert.Equal(HttpStatusCode.OK, admin.StatusCode);
        var cookie = login.Headers.GetValues("Set-Cookie").Single(value => value.StartsWith("gones_refresh=", StringComparison.Ordinal)).Split(';')[0];
        using var refreshRequest = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        refreshRequest.Headers.Add("Cookie", cookie);
        using var refresh = await client.SendAsync(refreshRequest);
        Assert.Equal(HttpStatusCode.OK, refresh.StatusCode);
        var restored = (await refresh.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
        using var reload = await AuthorizedAsync("/api/_contract/admin", restored);
        Assert.Equal(HttpStatusCode.NoContent, reload.StatusCode);
        Assert.Equal(0, (await CliAsync("owner", "setup")).ExitCode);
        Assert.Equal(0, (await CliAsync("owner", "promote")).ExitCode);
        db.ChangeTracker.Clear();
        var repeated = await db.Users.SingleAsync();
        Assert.Equal(user.Id, repeated.Id);
        Assert.True(user.PasswordHash == repeated.PasswordHash);
        Assert.Single(await db.NotificationOutboxRecords.Where(record => record.TemplateKey == "owner-setup").ToListAsync());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Ordinary_registration_verification_hard_deletion_permanently_disqualifies_setup(bool issueFirst)
    {
        await using var db = Db();
        var token = "invalid";
        if (issueFirst) { Assert.True((await IssueAsync(db)).Enqueued); token = await TokenAsync(); }
        var previous = await db.OwnerSetups.AsNoTracking().SingleAsync();
        using var registration = await RegisterAsync();
        Assert.Equal(HttpStatusCode.Accepted, registration.StatusCode);
        var verification = await db.NotificationOutboxRecords.SingleAsync(record => record.TemplateKey == "verify-email");
        var link = JsonDocument.Parse(verification.TemplateModelJson!).RootElement.GetProperty("actionUrl").GetString()!;
        var verificationToken = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(new Uri(link).Query)["token"].ToString();
        using var verified = await client.PostAsJsonAsync("/api/auth/verify-email", new { token = verificationToken });
        Assert.Equal(HttpStatusCode.NoContent, verified.StatusCode);
        using var login = await client.PostAsJsonAsync("/api/auth/login", new { email = Owner, password = Password });
        var access = (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
        using var deletion = new HttpRequestMessage(HttpMethod.Delete, "/api/users/me") { Content = JsonContent.Create(new { currentPassword = Password }) };
        deletion.Headers.Authorization = new AuthenticationHeaderValue("Bearer", access);
        using var deleted = await client.SendAsync(deletion);
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        db.ChangeTracker.Clear();
        Assert.Empty(await db.Users.ToListAsync());
        Assert.True(await db.AuditRecords.AnyAsync(record => record.Action == "account.deleted" && record.ActorId == null));
        var mailCount = await db.NotificationOutboxRecords.CountAsync();
        client.Dispose();
        await factory.DisposeAsync();
        factory = Factory();
        client = factory.CreateClient();
        if (!issueFirst) Assert.NotEqual(0, (await CliAsync("owner", "setup")).ExitCode);
        using var refused = await client.PostAsJsonAsync("/api/auth/owner-setup", Request(token));
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        foreach (var command in new[] { "setup", "resend", "promote" })
            Assert.NotEqual(0, (await CliAsync("owner", command)).ExitCode);
        db.ChangeTracker.Clear();
        var after = await db.OwnerSetups.SingleAsync();
        Assert.False(after.Enabled);
        Assert.True(previous.TokenHash == after.TokenHash);
        Assert.Equal(previous.IssuedAt, after.IssuedAt);
        Assert.Equal(mailCount, await db.NotificationOutboxRecords.CountAsync());
        Assert.Empty(await db.Users.ToListAsync());
        Assert.False(await db.SystemMarkers.AnyAsync(marker => marker.ConsumedAt != null));
    }

    [Fact]
    public async Task Concurrent_confirmation_consumes_once_without_session_or_public_admin()
    {
        await using var db = Db();
        Assert.True((await IssueAsync(db)).Enqueued);
        var token = await TokenAsync();
        var responses = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => client.PostAsJsonAsync("/api/auth/owner-setup", Request(token))));
        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.NoContent);
        Assert.Equal(3, responses.Count(response => response.StatusCode == HttpStatusCode.BadRequest));
        foreach (var response in responses) response.Dispose();
        Assert.Single(await db.Users.ToListAsync());
        Assert.Single(await db.UserProfiles.ToListAsync());
        Assert.Empty(await db.RefreshSessions.ToListAsync());
        Assert.Equal(GlobalRoles.User, (await db.Users.SingleAsync()).GlobalRole);
    }

    [Theory]
    [InlineData("production", Owner, "https://app.example")]
    [InlineData("testing", "other@example.test", "https://app.example")]
    [InlineData("testing", Owner, "https://other.example")]
    public async Task Copied_enrollment_token_rejected_by_receiving_environment_owner_or_origin(string deployment, string owner, string origin)
    {
        await using var db = Db();
        Assert.True((await IssueAsync(db)).Enqueued);
        var token = await TokenAsync();
        await using var receiving = Factory(owner, deployment, origin);
        using var http = receiving.CreateClient();
        using var response = await http.PostAsJsonAsync("/api/auth/owner-setup", Request(token));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(await db.Users.ToListAsync());
        Assert.Null((await db.OwnerSetups.AsNoTracking().SingleAsync()).CompletedAt);
    }

    [Theory]
    [InlineData("too-short")]
    [InlineData("passwordpassword")]
    public async Task Invalid_password_rolls_back_identity_profile_and_consumption(string password)
    {
        await using var db = Db();
        Assert.True((await IssueAsync(db)).Enqueued);
        var token = await TokenAsync();
        using var rejected = await client.PostAsJsonAsync("/api/auth/owner-setup", Request(token, password));
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        Assert.Empty(await db.Users.ToListAsync());
        Assert.Empty(await db.UserProfiles.ToListAsync());
        Assert.Null((await db.OwnerSetups.AsNoTracking().SingleAsync()).CompletedAt);
        using var accepted = await client.PostAsJsonAsync("/api/auth/owner-setup", Request(token));
        Assert.Equal(HttpStatusCode.NoContent, accepted.StatusCode);
    }

    [Fact]
    public async Task Resend_cooldown_is_persisted_and_exact_boundary_replaces_old_token()
    {
        await using var db = Db();
        var start = Instant.FromUnixTimeSeconds(SystemClock.Instance.GetCurrentInstant().ToUnixTimeSeconds()) - Duration.FromHours(2);
        Assert.True((await IssueAsync(db, clock: new FixedClock(start))).Enqueued);
        var old = await TokenAsync();
        db.ChangeTracker.Clear();
        Assert.False((await IssueAsync(db, true, new FixedClock(start + Duration.FromHours(1) - Duration.FromTicks(1)))).Succeeded);
        db.ChangeTracker.Clear();
        Assert.True((await IssueAsync(db, true, new FixedClock(start + Duration.FromHours(1)))).Enqueued);
        var current = await TokenAsync();
        Assert.False(old == current);
        using var superseded = await client.PostAsJsonAsync("/api/auth/owner-setup", Request(old));
        Assert.Equal(HttpStatusCode.BadRequest, superseded.StatusCode);
        using var valid = await client.PostAsJsonAsync("/api/auth/owner-setup", Request(current));
        Assert.Equal(HttpStatusCode.NoContent, valid.StatusCode);
    }

    [Fact]
    public async Task Expired_or_ordinary_purpose_tokens_cannot_complete_setup()
    {
        await using var db = Db();
        Assert.True((await IssueAsync(db, clock: new FixedClock(SystemClock.Instance.GetCurrentInstant() - Duration.FromHours(24)))).Enqueued);
        var token = await TokenAsync();
        using var expired = await client.PostAsJsonAsync("/api/auth/owner-setup", Request(token));
        Assert.Equal(HttpStatusCode.BadRequest, expired.StatusCode);
        await db.Database.ExecuteSqlRawAsync("UPDATE owner_setups SET expires_at = now() + interval '1 hour', token_hash = {0}",
            Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token))));
        using var wrongPurpose = await client.PostAsJsonAsync("/api/auth/owner-setup", Request(token));
        Assert.Equal(HttpStatusCode.BadRequest, wrongPurpose.StatusCode);
        Assert.Empty(await db.Users.ToListAsync());
    }

    private async Task<string> TokenAsync()
    {
        await using var db = Db();
        var mail = await db.NotificationOutboxRecords.Where(record => record.TemplateKey == "owner-setup").OrderByDescending(record => record.CreatedAt).FirstAsync();
        using var document = JsonDocument.Parse(mail.TemplateModelJson!);
        var link = new Uri(document.RootElement.GetProperty("actionUrl").GetString()!);
        Assert.Equal("", link.Query);
        return link.Fragment["#token=".Length..];
    }

    private async Task<HttpResponseMessage> AuthorizedAsync(string path, string token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await client.SendAsync(request);
    }

    private Task<(int ExitCode, string Output)> CliAsync(params string[] arguments) => CliWithSettingsAsync(new Dictionary<string, string?>(), arguments);

    private async Task<(int ExitCode, string Output)> CliWithSettingsAsync(IReadOnlyDictionary<string, string?> settings, params string[] arguments)
    {
        var build = AppContext.BaseDirectory.Contains("/Release/", StringComparison.Ordinal) ? "Release" : "Debug";
        var backendRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
        var start = new ProcessStartInfo("dotnet") { RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = backendRoot };
        start.ArgumentList.Add(Path.Combine(backendRoot, "src", "Gones.Migrator", "bin", build, "net10.0", "Gones.Migrator.dll"));
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        foreach (var key in start.Environment.Keys.Where(key => key.StartsWith("GONES_", StringComparison.Ordinal)).ToArray()) start.Environment.Remove(key);
        start.Environment["GONES_DB_CONNECTION"] = postgres.GetConnectionString();
        start.Environment["GONES_BOOTSTRAP_ADMIN_EMAIL"] = Owner;
        start.Environment["GONES_DEPLOYMENT_ENVIRONMENT"] = "testing";
        start.Environment["GONES_PUBLIC_APP_ORIGIN"] = "https://app.example";
        start.Environment["DOTNET_ENVIRONMENT"] = "Testing";
        foreach (var (key, value) in settings)
        {
            if (value is null) start.Environment.Remove(key);
            else start.Environment[key] = value;
        }
        using var process = Process.Start(start)!;
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        var output = await stdout + await stderr;
        Assert.False(output.Contains(Owner, StringComparison.OrdinalIgnoreCase), "CLI must not print the configured owner.");
        Assert.False(output.Contains(Password, StringComparison.Ordinal), "CLI must not print the password.");
        return (process.ExitCode, output);
    }

    private sealed class FixedClock(Instant now) : IClock { public Instant GetCurrentInstant() => now; }

    private Task<HttpResponseMessage> RegisterAsync() => client.PostAsJsonAsync("/api/auth/register", new
    {
        email = Owner, username = "OrdinaryOwner", password = Password, firstName = "Fixture", lastName = "Owner"
    });

    private IConfiguration Configuration(string deployment = "testing", string owner = Owner, string origin = "https://app.example") =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["GONES_BOOTSTRAP_ADMIN_EMAIL"] = owner,
            ["GONES_DEPLOYMENT_ENVIRONMENT"] = deployment,
            ["GONES_PUBLIC_APP_ORIGIN"] = origin
        }).Build();

    private Task<OwnerSetupIssuance> IssueAsync(GonesDbContext db, bool resend = false, IClock? clock = null) =>
        new OwnerSetupService(db, new NotificationOutbox(db, clock ?? SystemClock.Instance), clock ?? SystemClock.Instance, StagingAccessPolicy.Unrestricted)
            .IssueAsync(OwnerSetupOptions.Load(Configuration()), resend);

    private ServiceProvider PromotionProvider(IConfiguration? configuration = null)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddGonesPersistence(postgres.GetConnectionString());
        services.AddSingleton<IConfiguration>(configuration ?? Configuration());
        services.AddSingleton(StagingAccessPolicy.Unrestricted);
        services.AddScoped<AdminBootstrapService>();
        return services.BuildServiceProvider();
    }

    private static object Request(string token, string password = Password) => new
    {
        token, password, username = "OwnerFixture", firstName = "Fixture", lastName = "Owner", globalRole = "Admin"
    };

    private WebApplicationFactory<Program> Factory(string? owner = Owner, string deployment = "testing", string origin = "https://app.example") =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", origin);
            builder.UseSetting("GONES_FEATURES:AUTH_V1", "true");
            builder.UseSetting("GONES_FEATURES:ADMIN_V1", "true");
            builder.UseSetting("GONES_AUTH_PROVIDER", "Local");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "s6-fixture-signing-key-at-least-32-characters");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", origin);
            builder.UseSetting("GONES_DEPLOYMENT_ENVIRONMENT", deployment);
            if (owner is not null) builder.UseSetting("GONES_BOOTSTRAP_ADMIN_EMAIL", owner);
            builder.UseSetting("GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT", "1000");
        });

    private GonesDbContext Db() => new(new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options);
}
