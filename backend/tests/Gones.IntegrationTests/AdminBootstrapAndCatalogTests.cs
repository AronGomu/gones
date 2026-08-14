using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Identity;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.IntegrationTests;

public sealed class AdminBootstrapAndCatalogTests : IAsyncLifetime
{
    private const string SigningKey = "c13-admin-integration-signing-key-with-more-than-32-characters";
    private readonly PostgreSqlTestContainer postgres = new();
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var database = CreateContext()) await database.Database.MigrateAsync();
        factory = CreateFactory();
        client = factory.CreateClient();
    }

    public async Task DisposeAsync()
    {
        client?.Dispose();
        if (factory is not null) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Public_formats_lists_seeded_legacy_only_active()
    {
        using var response = await Client.GetAsync("/api/formats");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(JsonValueKind.Array, body.ValueKind);
        Assert.Equal(1, body.GetArrayLength());
        Assert.Equal("legacy", body[0].GetProperty("slug").GetString());
        Assert.Equal("Legacy", body[0].GetProperty("name").GetString());
    }

    [Fact]
    public async Task Bootstrap_promotes_verified_user_once_then_safe_noop()
    {
        var email = $"bootstrap-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(email, $"Boot{Guid.NewGuid():N}"[..12]);

        var first = await RunBootstrapCliAsync(email, configuredEmail: email);
        Assert.Equal(0, first.ExitCode);
        Assert.Contains("Promoted", first.Stdout, StringComparison.Ordinal);

        await using (var database = CreateContext())
        {
            var user = await database.Users.SingleAsync(item => item.NormalizedEmail == email.ToUpperInvariant());
            Assert.Equal(GlobalRoles.Admin, user.GlobalRole);
            Assert.True(await database.SystemMarkers.AnyAsync(marker => marker.Key == AdminBootstrapPolicy.MarkerKey && marker.ConsumedAt != null));
        }

        var second = await RunBootstrapCliAsync(email, configuredEmail: email);
        Assert.Equal(0, second.ExitCode);
        Assert.True(
            second.Stdout.Contains("no-op", StringComparison.OrdinalIgnoreCase)
            || second.Stdout.Contains("already", StringComparison.OrdinalIgnoreCase),
            second.Stdout);

        await using (var database = CreateContext())
        {
            Assert.Equal(1, await database.Users.CountAsync(item => item.GlobalRole == GlobalRoles.Admin && item.NormalizedEmail == email.ToUpperInvariant()));
        }
    }

    [Fact]
    public async Task Bootstrap_rejects_wrong_config_and_unverified_user()
    {
        var email = $"boot-bad-{Guid.NewGuid():N}@example.test";
        using var registration = await RegisterAsync(email, $"Bad{Guid.NewGuid():N}"[..12]);
        Assert.Equal(HttpStatusCode.Created, registration.StatusCode);

        var wrongConfig = await RunBootstrapCliAsync(email, configuredEmail: "other@example.test");
        Assert.NotEqual(0, wrongConfig.ExitCode);
        Assert.Contains("does not match", wrongConfig.Stderr, StringComparison.Ordinal);

        var unverified = await RunBootstrapCliAsync(email, configuredEmail: email);
        Assert.NotEqual(0, unverified.ExitCode);
        Assert.Contains("verified", unverified.Stderr, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Admin_user_list_and_role_grant_revoke_with_last_admin_protection()
    {
        var adminEmail = $"admin-{Guid.NewGuid():N}@example.test";
        var organizerEmail = $"org-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(adminEmail, $"Adm{Guid.NewGuid():N}"[..12]);
        await RegisterAndVerifyAsync(organizerEmail, $"Org{Guid.NewGuid():N}"[..12]);
        await PromoteToAdminAsync(adminEmail);

        var adminToken = await LoginAsync(adminEmail, "valid-password-value");
        using var list = await SendAuthorizedAsync(HttpMethod.Get, $"/api/admin/users?search={Uri.EscapeDataString(organizerEmail)}&page=1&pageSize=10", adminToken);
        var listBody = await list.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        Assert.True(listBody.GetProperty("totalCount").GetInt32() >= 1);

        await using var database = CreateContext();
        var organizer = await database.Users.SingleAsync(item => item.NormalizedEmail == organizerEmail.ToUpperInvariant());
        var admin = await database.Users.SingleAsync(item => item.NormalizedEmail == adminEmail.ToUpperInvariant());

        using var grant = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{organizer.Id:D}/roles/Organizer/grant", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, grant.StatusCode);

        database.ChangeTracker.Clear();
        organizer = await database.Users.SingleAsync(item => item.Id == organizer.Id);
        Assert.Equal(GlobalRoles.Organizer, organizer.GlobalRole);

        using var grantAdmin = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{organizer.Id:D}/roles/Admin/grant", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, grantAdmin.StatusCode);

        using var selfRevoke = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{admin.Id:D}/roles/Admin/revoke", adminToken);
        Assert.Equal(HttpStatusCode.Conflict, selfRevoke.StatusCode);

        var secondAdminToken = await LoginAsync(organizerEmail, "valid-password-value");
        using var revokeOther = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{admin.Id:D}/roles/Admin/revoke", secondAdminToken);
        Assert.Equal(HttpStatusCode.NoContent, revokeOther.StatusCode);

        using var lastRevoke = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{organizer.Id:D}/roles/Admin/revoke", secondAdminToken);
        Assert.Equal(HttpStatusCode.Conflict, lastRevoke.StatusCode);
    }

    [Fact]
    public async Task Role_revoke_rejects_stale_privileged_jwt_and_refresh_family()
    {
        var adminEmail = $"stamp-admin-{Guid.NewGuid():N}@example.test";
        var targetEmail = $"stamp-target-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(adminEmail, $"SAdm{Guid.NewGuid():N}"[..12]);
        await RegisterAndVerifyAsync(targetEmail, $"STgt{Guid.NewGuid():N}"[..12]);
        await PromoteToAdminAsync(adminEmail);

        var adminToken = await LoginAsync(adminEmail, "valid-password-value");
        await using var database = CreateContext();
        var target = await database.Users.SingleAsync(item => item.NormalizedEmail == targetEmail.ToUpperInvariant());
        using var promote = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{target.Id:D}/roles/Admin/grant", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, promote.StatusCode);

        using var targetClient = factory!.CreateClient();
        var privilegedToken = await LoginWithClientAsync(targetClient, targetEmail, "valid-password-value");
        using var before = await SendAuthorizedWithClientAsync(targetClient, HttpMethod.Get, "/api/_contract/admin", privilegedToken);
        Assert.Equal(HttpStatusCode.NoContent, before.StatusCode);

        using var demote = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{target.Id:D}/roles/Admin/revoke", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, demote.StatusCode);

        using var after = await SendAuthorizedWithClientAsync(targetClient, HttpMethod.Get, "/api/_contract/admin", privilegedToken);
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode);

        using var refresh = await targetClient.PostAsync("/api/auth/refresh", null);
        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);

        database.ChangeTracker.Clear();
        var sessions = await database.RefreshSessions.Where(item => item.UserId == target.Id).ToListAsync();
        Assert.NotEmpty(sessions);
        Assert.All(sessions, session => Assert.NotNull(session.RevokedAt));
        Assert.Contains(sessions, session => session.RevocationReason == RefreshSessionRevocationReason.RoleChanged);
    }

    [Fact]
    public async Task Non_admin_cannot_grant_roles()
    {
        var email = $"user-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(email, $"Usr{Guid.NewGuid():N}"[..12]);
        var token = await LoginAsync(email, "valid-password-value");
        await using var database = CreateContext();
        var user = await database.Users.SingleAsync(item => item.NormalizedEmail == email.ToUpperInvariant());

        using var response = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{user.Id:D}/roles/Organizer/grant", token);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Admin_format_crud_enforces_unique_slug_and_soft_delete()
    {
        var adminEmail = $"fmt-admin-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(adminEmail, $"Fmt{Guid.NewGuid():N}"[..12]);
        await PromoteToAdminAsync(adminEmail);
        var token = await LoginAsync(adminEmail, "valid-password-value");

        using var create = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/formats", token, new { name = "Modern", slug = "modern", sortOrder = 10 });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        var id = created.GetProperty("id").GetGuid();

        using var duplicate = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/formats", token, new { name = "Modern 2", slug = "modern", sortOrder = 11 });
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);

        await using (var eventDatabase = CreateContext())
        {
            var admin = await eventDatabase.Users.SingleAsync(item => item.NormalizedEmail == adminEmail.ToUpperInvariant());
            var format = await eventDatabase.TournamentFormats.SingleAsync(item => item.Id == id);
            var organization = Organization.Create($"Format Club {Guid.NewGuid():N}", null, null, null, SystemClock.Instance.GetCurrentInstant());
            eventDatabase.Organizations.Add(organization);
            await eventDatabase.SaveChangesAsync();
            eventDatabase.Events.Add(Event.Create(
                organization.Id,
                admin.Id,
                new ScheduledTournamentDraft(
                    "Modern Cup", "modern-cup", null, null, "12 Street", null, "Paris", "France", "Europe/Paris",
                    new LocalDateTime(2035, 3, 4, 10, 0), new LocalDateTime(2035, 3, 4, 18, 0), 32),
                [format],
                SystemClock.Instance.GetCurrentInstant()));
            await eventDatabase.SaveChangesAsync();
        }

        using var referencedDelete = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/admin/formats/{id:D}", token);
        Assert.Equal(HttpStatusCode.Conflict, referencedDelete.StatusCode);

        await using (var eventDatabase = CreateContext())
        {
            var tournament = await eventDatabase.Events.SingleAsync(item => item.Title == "Modern Cup");
            tournament.SoftDelete(tournament.CreatedByUserId, null, SystemClock.Instance.GetCurrentInstant());
            await eventDatabase.SaveChangesAsync();
        }

        using var del = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/admin/formats/{id:D}", token);
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

        using var publicList = await Client.GetAsync("/api/formats");
        var publicBody = await publicList.Content.ReadFromJsonAsync<JsonElement>();
        Assert.DoesNotContain(publicBody.EnumerateArray(), item => item.GetProperty("slug").GetString() == "modern");

        await using var database = CreateContext();
        var legacy = await database.TournamentFormats.SingleAsync(item => item.Slug == TournamentFormat.LegacySlug);
        using var deleteLegacy = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/admin/formats/{legacy.Id:D}", token);
        Assert.Equal(HttpStatusCode.Conflict, deleteLegacy.StatusCode);
    }

    private WebApplicationFactory<Program> CreateFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_FEATURES:AUTH_V1", "true");
            builder.UseSetting("GONES_FEATURES:ADMIN_V1", "true");
            builder.UseSetting("GONES_AUTH_PROVIDER", "Local");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", SigningKey);
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            builder.UseSetting("GONES_AUTH_RATE_LIMIT_PERMIT_LIMIT", "1000");
        });

    private async Task PromoteToAdminAsync(string email)
    {
        await using var database = CreateContext();
        var user = await database.Users.SingleAsync(item => item.NormalizedEmail == email.ToUpperInvariant());
        user.AssignGlobalRole(GlobalRoles.Admin);
        user.SecurityStamp = Guid.NewGuid().ToString("N");
        await database.SaveChangesAsync();
    }

    private async Task RegisterAndVerifyAsync(string email, string username)
    {
        using var registration = await RegisterAsync(email, username);
        Assert.Equal(HttpStatusCode.Created, registration.StatusCode);
        await using var database = CreateContext();
        var user = await database.Users.SingleAsync(item => item.NormalizedEmail == email.ToUpperInvariant());
        user.EmailConfirmed = true;
        await database.SaveChangesAsync();
    }

    private async Task<HttpResponseMessage> RegisterAsync(string email, string username) =>
        await Client.PostAsJsonAsync("/api/auth/register", new
        {
            email,
            username,
            password = "valid-password-value",
            firstName = "Test",
            lastName = "User"
        });

    private Task<string> LoginAsync(string email, string password) => LoginWithClientAsync(Client, email, password);

    private static async Task<string> LoginWithClientAsync(HttpClient httpClient, string email, string password)
    {
        using var response = await httpClient.PostAsJsonAsync("/api/auth/login", new { email, password, deviceLabel = "test" });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("accessToken").GetString()!;
    }

    private Task<HttpResponseMessage> SendAuthorizedAsync(HttpMethod method, string url, string token, object? body = null) =>
        SendAuthorizedWithClientAsync(Client, method, url, token, body);

    private static async Task<HttpResponseMessage> SendAuthorizedWithClientAsync(HttpClient httpClient, HttpMethod method, string url, string token, object? body = null)
    {
        using var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (body is not null) request.Content = JsonContent.Create(body);
        return await httpClient.SendAsync(request);
    }

    private async Task<(int ExitCode, string Stdout, string Stderr)> RunBootstrapCliAsync(string email, string configuredEmail)
    {
        var configuration = AppContext.BaseDirectory.Contains($"{Path.DirectorySeparatorChar}Release{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase)
            ? "Release"
            : "Debug";
        var backendRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
        var migratorProject = Path.Combine(backendRoot, "src", "Gones.Migrator", "Gones.Migrator.csproj");
        var migrator = Path.Combine(backendRoot, "src", "Gones.Migrator", "bin", configuration, "net10.0", "Gones.Migrator.dll");
        if (!File.Exists(migrator))
        {
            var build = Process.Start(new ProcessStartInfo("dotnet")
            {
                ArgumentList = { "build", migratorProject, "-c", configuration, "--nologo" },
                RedirectStandardOutput = true,
                RedirectStandardError = true
            })!;
            await build.WaitForExitAsync();
            Assert.True(build.ExitCode == 0, await build.StandardError.ReadToEndAsync());
        }

        var start = new ProcessStartInfo("dotnet")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
        start.ArgumentList.Add(migrator);
        start.ArgumentList.Add("admin");
        start.ArgumentList.Add("bootstrap");
        start.ArgumentList.Add("--email");
        start.ArgumentList.Add(email);
        start.Environment["GONES_DB_CONNECTION"] = postgres.GetConnectionString();
        start.Environment["GONES_BOOTSTRAP_ADMIN_EMAIL"] = configuredEmail;

        using var process = Process.Start(start)!;
        var stdout = await process.StandardOutput.ReadToEndAsync();
        var stderr = await process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(60));
        return (process.ExitCode, stdout, stderr);
    }

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>()
            .UseNpgsql(postgres.GetConnectionString(), npgsql => npgsql.UseNodaTime())
            .Options;
        return new GonesDbContext(options);
    }
}
