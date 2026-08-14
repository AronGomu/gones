using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Domain.Catalog;
using Gones.Domain.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;

namespace Gones.IntegrationTests;

public sealed class DeckArchetypeCatalogApiTests : IAsyncLifetime
{
    private const string SigningKey = "c36-deck-archetype-integration-signing-key-with-length";
    private readonly PostgreSqlTestContainer postgres = new();
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var database = CreateContext()) await database.Database.MigrateAsync();
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
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
        client = factory.CreateClient();
    }

    public async Task DisposeAsync()
    {
        client?.Dispose();
        if (factory is not null) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Public_deck_archetypes_lists_seeded_legacy_presets()
    {
        using var response = await Client.GetAsync("/api/deck-archetypes");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Array, body.ValueKind);
        var names = body.EnumerateArray().Select(item => item.GetProperty("name").GetString()).ToArray();
        Assert.Equal(DeckArchetypePresets.LegacyNames.Count, names.Length);
        Assert.Contains("Reanimator (Rakdos)", names);
        Assert.Contains("Burn (Red)", names);
    }

    [Fact]
    public async Task Admin_deck_archetype_crud_enforces_case_space_uniqueness_and_soft_delete()
    {
        var token = await CreateAdminAsync($"arch-admin-{Guid.NewGuid():N}@example.test");

        using var create = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/deck-archetypes", token, new { name = "  Mono   Red " });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Mono Red", created.GetProperty("name").GetString());
        var id = created.GetProperty("id").GetGuid();

        using var duplicate = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/deck-archetypes", token, new { name = "MONO  red" });
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);

        using var renameConflict = await SendAuthorizedAsync(HttpMethod.Put, $"/api/admin/deck-archetypes/{id:D}", token, new { name = "burn (red)" });
        Assert.Equal(HttpStatusCode.Conflict, renameConflict.StatusCode);

        using var rename = await SendAuthorizedAsync(HttpMethod.Put, $"/api/admin/deck-archetypes/{id:D}", token, new { name = "Mono Red Prison" });
        Assert.Equal(HttpStatusCode.OK, rename.StatusCode);
        Assert.Equal("Mono Red Prison", (await rename.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("name").GetString());

        using var delete = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/admin/deck-archetypes/{id:D}", token);
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);

        using var publicList = await Client.GetAsync("/api/deck-archetypes");
        var publicNames = (await publicList.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray()
            .Select(item => item.GetProperty("name").GetString()).ToArray();
        Assert.DoesNotContain("Mono Red Prison", publicNames);

        using var adminList = await SendAuthorizedAsync(HttpMethod.Get, "/api/admin/deck-archetypes", token);
        var deletedRow = (await adminList.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray()
            .Single(item => item.GetProperty("id").GetGuid() == id);
        Assert.Equal("Mono Red Prison", deletedRow.GetProperty("name").GetString());
        Assert.NotEqual(JsonValueKind.Null, deletedRow.GetProperty("deletedAt").ValueKind);

        using var restore = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/deck-archetypes/{id:D}/restore", token);
        Assert.Equal(HttpStatusCode.NoContent, restore.StatusCode);
        using var publicAfterRestore = await Client.GetAsync("/api/deck-archetypes");
        Assert.Contains("Mono Red Prison", (await publicAfterRestore.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray()
            .Select(item => item.GetProperty("name").GetString()));
    }

    [Fact]
    public async Task Admin_deck_archetype_import_adds_restores_and_skips()
    {
        var token = await CreateAdminAsync($"arch-import-{Guid.NewGuid():N}@example.test");

        using var create = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/deck-archetypes", token, new { name = "Temp Brew" });
        var id = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        using var delete = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/admin/deck-archetypes/{id:D}", token);
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);

        using var import = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/deck-archetypes/import", token, new
        {
            names = new[] { " temp   brew ", "burn (RED)", "Fresh Brew" }
        });
        Assert.Equal(HttpStatusCode.OK, import.StatusCode);
        var result = await import.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, result.GetProperty("added").GetInt32());
        Assert.Equal(1, result.GetProperty("restored").GetInt32());
        Assert.Equal(1, result.GetProperty("skipped").GetInt32());

        using var publicList = await Client.GetAsync("/api/deck-archetypes");
        var names = (await publicList.Content.ReadFromJsonAsync<JsonElement>()).EnumerateArray()
            .Select(item => item.GetProperty("name").GetString()).ToArray();
        Assert.Contains("Temp Brew", names);
        Assert.Contains("Fresh Brew", names);
    }

    [Fact]
    public async Task Organizer_cannot_mutate_global_catalog()
    {
        var email = $"arch-organizer-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(email, $"Org{Guid.NewGuid():N}"[..12]);
        await AssignRoleAsync(email, GlobalRoles.Organizer);
        var token = await LoginAsync(email);

        using var list = await SendAuthorizedAsync(HttpMethod.Get, "/api/admin/deck-archetypes", token);
        Assert.Equal(HttpStatusCode.Forbidden, list.StatusCode);
        using var create = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/deck-archetypes", token, new { name = "Organizer Brew" });
        Assert.Equal(HttpStatusCode.Forbidden, create.StatusCode);
        using var import = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/deck-archetypes/import", token, new { names = new[] { "Organizer Brew" } });
        Assert.Equal(HttpStatusCode.Forbidden, import.StatusCode);
    }

    private async Task<string> CreateAdminAsync(string email)
    {
        await RegisterAndVerifyAsync(email, $"Adm{Guid.NewGuid():N}"[..12]);
        await AssignRoleAsync(email, GlobalRoles.Admin);
        return await LoginAsync(email);
    }

    private async Task AssignRoleAsync(string email, string role)
    {
        await using var database = CreateContext();
        var user = await database.Users.SingleAsync(item => item.NormalizedEmail == email.ToUpperInvariant());
        user.AssignGlobalRole(role);
        user.SecurityStamp = Guid.NewGuid().ToString("N");
        await database.SaveChangesAsync();
    }

    private async Task RegisterAndVerifyAsync(string email, string username)
    {
        using var registration = await Client.PostAsJsonAsync("/api/auth/register", new
        {
            email,
            username,
            password = "valid-password-value",
            firstName = "Test",
            lastName = "User"
        });
        Assert.Equal(HttpStatusCode.Created, registration.StatusCode);
        await using var database = CreateContext();
        var user = await database.Users.SingleAsync(item => item.NormalizedEmail == email.ToUpperInvariant());
        user.EmailConfirmed = true;
        await database.SaveChangesAsync();
    }

    private async Task<string> LoginAsync(string email)
    {
        using var response = await Client.PostAsJsonAsync("/api/auth/login", new { email, password = "valid-password-value", deviceLabel = "test" });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("accessToken").GetString()!;
    }

    private async Task<HttpResponseMessage> SendAuthorizedAsync(HttpMethod method, string url, string token, object? body = null)
    {
        using var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (body is not null) request.Content = JsonContent.Create(body);
        return await Client.SendAsync(request);
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
