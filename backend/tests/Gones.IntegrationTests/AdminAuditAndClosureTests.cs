using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Domain.Identity;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;

namespace Gones.IntegrationTests;

public sealed class AdminAuditAndClosureTests : IAsyncLifetime
{
    private const string SigningKey = "c15-admin-closure-integration-signing-key-32chars";
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
    public async Task Audit_query_filters_redacted_diffs_and_rejects_non_admin()
    {
        var adminEmail = $"audit-admin-{Guid.NewGuid():N}@example.test";
        var userEmail = $"audit-user-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(adminEmail, UniqueUsername("AAdm"));
        await RegisterAndVerifyAsync(userEmail, UniqueUsername("AUsr"));
        await PromoteToAdminAsync(adminEmail);

        var adminToken = await LoginAsync(adminEmail);
        await using var database = CreateContext();
        var user = await database.Users.SingleAsync(item => item.NormalizedEmail == userEmail.ToUpperInvariant());
        using var grant = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{user.Id:D}/roles/Organizer/grant", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, grant.StatusCode);

        using var list = await SendAuthorizedAsync(
            HttpMethod.Get,
            $"/api/admin/audit?action=admin.role&entityType=user&entityId={user.Id:D}&page=1&pageSize=20",
            adminToken);
        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        Assert.True(body.GetProperty("totalCount").GetInt32() >= 1);
        var first = body.GetProperty("items")[0];
        Assert.Equal("user", first.GetProperty("entityType").GetString());
        Assert.True(first.TryGetProperty("redactedDiff", out var diff));
        Assert.DoesNotContain("password", diff.GetString() ?? string.Empty, StringComparison.OrdinalIgnoreCase);

        var userToken = await LoginAsync(userEmail);
        using var denied = await SendAuthorizedAsync(HttpMethod.Get, "/api/admin/audit", userToken);
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
    }

    /// <summary>
    /// ADR 0041: a closure is never refused for an organization's sake. It drops every membership the
    /// account held, leaves the organizations standing - member-less ones as Draft - and anonymizes
    /// and revokes exactly as before.
    /// </summary>
    [Fact]
    public async Task Disable_drops_memberships_then_anonymizes_and_revokes()
    {
        var adminEmail = $"close-admin-{Guid.NewGuid():N}@example.test";
        var ownerEmail = $"close-owner-{Guid.NewGuid():N}@example.test";
        var mateEmail = $"close-mate-{Guid.NewGuid():N}@example.test";
        var ownerUsername = UniqueUsername("COwn");
        await RegisterAndVerifyAsync(adminEmail, UniqueUsername("CAdm"));
        await RegisterAndVerifyAsync(ownerEmail, ownerUsername);
        await RegisterAndVerifyAsync(mateEmail, UniqueUsername("CMat"));
        await PromoteToAdminAsync(adminEmail);

        await using var database = CreateContext();
        var owner = await database.Users.SingleAsync(item => item.NormalizedEmail == ownerEmail.ToUpperInvariant());
        var mate = await database.Users.SingleAsync(item => item.NormalizedEmail == mateEmail.ToUpperInvariant());
        var adminToken = await LoginAsync(adminEmail);

        var marker = $"{Guid.NewGuid():N}";
        var orgA = await CreateOrganizationAsync(adminToken, $"Closure Club A {marker}", owner.Id);
        var orgB = await CreateOrganizationAsync(adminToken, $"Closure Club B {marker}", owner.Id);

        // The member signs in so the closure below has a live refresh session to revoke.
        _ = await LoginAsync(ownerEmail);
        // Adding a member is admin-only: it grants the global Organizer role.
        using var addMate = await SendAuthorizedAsync(HttpMethod.Post, $"/api/organizations/{orgA:D}/members", adminToken, new
        {
            userId = mate.Id,
            role = OrganizationRoles.Organizer
        });
        Assert.Equal(HttpStatusCode.Created, addMate.StatusCode);

        // The impact carries no successor to name and no organization to hand over.
        using var impact = await SendAuthorizedAsync(HttpMethod.Get, $"/api/admin/users/{owner.Id:D}/closure-impact", adminToken);
        var impactBody = await impact.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, impact.StatusCode);
        Assert.True(impactBody.GetProperty("canClose").GetBoolean());
        Assert.Null(impactBody.GetProperty("blockReason").GetString());
        Assert.False(impactBody.TryGetProperty("soleOwnedOrganizations", out _));
        Assert.DoesNotContain("suggestedNewOwnerUserId", impactBody.GetRawText(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal(2, impactBody.GetProperty("otherMembershipOrganizationIds").GetArrayLength());

        using var badUsername = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{owner.Id:D}/disable", adminToken, new
        {
            confirmedUsername = "wrong-name"
        });
        Assert.Equal(HttpStatusCode.BadRequest, badUsername.StatusCode);

        using var close = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{owner.Id:D}/disable", adminToken, new
        {
            confirmedUsername = ownerUsername
        });
        Assert.Equal(HttpStatusCode.NoContent, close.StatusCode);

        database.ChangeTracker.Clear();
        owner = await database.Users.SingleAsync(item => item.Id == owner.Id);
        var profile = await database.UserProfiles.SingleAsync(item => item.UserId == owner.Id);
        Assert.True(profile.IsClosed);
        Assert.Equal(AccountClosureIdentity.OpaqueUsername(owner.Id), profile.Username);
        Assert.Equal(AccountClosureIdentity.OpaqueEmail(owner.Id), owner.Email);
        Assert.Equal(GlobalRoles.User, owner.GlobalRole);
        Assert.True(owner.LockoutEnabled);
        Assert.NotNull(owner.LockoutEnd);
        Assert.Empty(await database.OrganizationMembers.Where(item => item.UserId == owner.Id).ToListAsync());
        Assert.Empty(await database.ExternalIdentities.Where(item => item.UserId == owner.Id).ToListAsync());
        // Club A keeps the member who was left behind; Club B is left with nobody, which is Draft.
        Assert.Equal(mate.Id, await database.OrganizationMembers
            .Where(item => item.OrganizationId == orgA)
            .Select(item => item.UserId)
            .SingleAsync());
        Assert.Empty(await database.OrganizationMembers.Where(item => item.OrganizationId == orgB).ToListAsync());
        using var listed = await SendAuthorizedAsync(HttpMethod.Get, $"/api/admin/organizations?search={marker}", adminToken);
        var draftBody = (await listed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items")
            .EnumerateArray()
            .Single(item => item.GetProperty("id").GetGuid() == orgB);
        Assert.Equal(0, draftBody.GetProperty("memberCount").GetInt32());
        Assert.True(draftBody.GetProperty("isDraft").GetBoolean());
        var sessions = await database.RefreshSessions.Where(item => item.UserId == owner.Id).ToListAsync();
        Assert.NotEmpty(sessions);
        Assert.All(sessions, session => Assert.NotNull(session.RevokedAt));
        Assert.Contains(sessions, session => session.RevocationReason == RefreshSessionRevocationReason.AccountClosed);

        using var loginClosed = await Client.PostAsJsonAsync("/api/auth/login", new { email = ownerEmail, password = "valid-password-value", deviceLabel = "test" });
        Assert.Equal(HttpStatusCode.Unauthorized, loginClosed.StatusCode);

        using var already = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{owner.Id:D}/disable", adminToken, new
        {
            confirmedUsername = profile.Username
        });
        Assert.Equal(HttpStatusCode.Conflict, already.StatusCode);
    }

    [Fact]
    public async Task Disable_rejects_self_and_last_admin_without_replacement()
    {
        var adminEmail = $"solo-admin-{Guid.NewGuid():N}@example.test";
        var adminUsername = UniqueUsername("SAdm");
        await RegisterAndVerifyAsync(adminEmail, adminUsername);
        await PromoteToAdminAsync(adminEmail);
        var adminToken = await LoginAsync(adminEmail);
        await using var database = CreateContext();
        var admin = await database.Users.SingleAsync(item => item.NormalizedEmail == adminEmail.ToUpperInvariant());

        using var self = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{admin.Id:D}/disable", adminToken, new
        {
            confirmedUsername = adminUsername
        });
        Assert.Equal(HttpStatusCode.Conflict, self.StatusCode);

        var otherEmail = $"other-admin-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(otherEmail, UniqueUsername("OAdm"));
        var other = await database.Users.SingleAsync(item => item.NormalizedEmail == otherEmail.ToUpperInvariant());
        using var promote = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{other.Id:D}/roles/Admin/grant", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, promote.StatusCode);

        using var closeOther = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{other.Id:D}/disable", adminToken, new
        {
            confirmedUsername = await database.UserProfiles.Where(item => item.UserId == other.Id).Select(item => item.Username).SingleAsync()
        });
        Assert.Equal(HttpStatusCode.NoContent, closeOther.StatusCode);
    }

    /// <summary>
    /// T19: the Users page disables a self-revoke, but a disabled attribute is an affordance, not a
    /// guard. The refusal is unconditional - a second Admin exists here, so it is not the last-Admin
    /// rule answering - and the actor keeps the role they tried to drop.
    /// </summary>
    [Fact]
    public async Task Revoking_your_own_Admin_role_is_refused_even_with_another_Admin_left()
    {
        var adminEmail = $"self-revoke-admin-{Guid.NewGuid():N}@example.test";
        var otherEmail = $"self-revoke-other-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(adminEmail, UniqueUsername("RAdm"));
        await RegisterAndVerifyAsync(otherEmail, UniqueUsername("ROth"));
        await PromoteToAdminAsync(adminEmail);
        var adminToken = await LoginAsync(adminEmail);

        await using var database = CreateContext();
        var admin = await database.Users.AsNoTracking().SingleAsync(item => item.NormalizedEmail == adminEmail.ToUpperInvariant());
        var other = await database.Users.AsNoTracking().SingleAsync(item => item.NormalizedEmail == otherEmail.ToUpperInvariant());
        using var promote = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{other.Id:D}/roles/Admin/grant", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, promote.StatusCode);

        using var selfRevoke = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{admin.Id:D}/roles/Admin/revoke", adminToken);
        Assert.Equal(HttpStatusCode.Conflict, selfRevoke.StatusCode);
        Assert.Equal(GlobalRoles.Admin, await GlobalRoleAsync(admin.Id));

        // Revoking the other Admin from the same actor is allowed, so the refusal above is about the
        // actor being the subject, nothing else.
        using var revokeOther = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{other.Id:D}/roles/Admin/revoke", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, revokeOther.StatusCode);
        Assert.Equal(GlobalRoles.User, await GlobalRoleAsync(other.Id));
    }

    /// <summary>
    /// An archived organization can lose its last member too, and comes back from the archive as a
    /// Draft with the closed account keeping no stale Organizer role.
    /// </summary>
    [Fact]
    public async Task Closing_the_only_member_of_a_deleted_organization_returns_it_to_draft()
    {
        var adminEmail = $"draft-admin-{Guid.NewGuid():N}@example.test";
        var ownerEmail = $"draft-owner-{Guid.NewGuid():N}@example.test";
        var ownerUsername = UniqueUsername("DOwn");
        await RegisterAndVerifyAsync(adminEmail, UniqueUsername("DAdm"));
        await RegisterAndVerifyAsync(ownerEmail, ownerUsername);
        await PromoteToAdminAsync(adminEmail);

        await using var database = CreateContext();
        var owner = await database.Users.SingleAsync(item => item.NormalizedEmail == ownerEmail.ToUpperInvariant());
        var adminToken = await LoginAsync(adminEmail);
        var marker = $"{Guid.NewGuid():N}";
        var orgId = await CreateOrganizationAsync(adminToken, $"Draft Closure {marker}", owner.Id);
        Assert.Equal(GlobalRoles.Organizer, await GlobalRoleAsync(owner.Id));

        using var softDelete = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/admin/organizations/{orgId:D}", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, softDelete.StatusCode);

        using var impact = await SendAuthorizedAsync(HttpMethod.Get, $"/api/admin/users/{owner.Id:D}/closure-impact", adminToken);
        var impactBody = await impact.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(impactBody.GetProperty("canClose").GetBoolean());

        using var close = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{owner.Id:D}/disable", adminToken, new
        {
            confirmedUsername = ownerUsername
        });
        Assert.Equal(HttpStatusCode.NoContent, close.StatusCode);
        Assert.Equal(GlobalRoles.User, await GlobalRoleAsync(owner.Id));
        Assert.Empty(await database.OrganizationMembers.AsNoTracking().Where(item => item.UserId == owner.Id).ToListAsync());

        using var restore = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/organizations/{orgId:D}/restore", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, restore.StatusCode);
        using var list = await SendAuthorizedAsync(HttpMethod.Get, $"/api/admin/organizations?search={marker}", adminToken);
        var listed = (await list.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items").EnumerateArray().Single();
        Assert.Equal(orgId, listed.GetProperty("id").GetGuid());
        Assert.Equal(0, listed.GetProperty("memberCount").GetInt32());
        Assert.True(listed.GetProperty("isDraft").GetBoolean());
    }

    /// <summary>
    /// T11 repair, lock order: a closure and a membership change on the same account both take the
    /// organization row before the user row. Running them head-on must end in two clean answers -
    /// never a 500, never a deadlock abort surfaced raw.
    /// </summary>
    [Fact]
    public async Task Closure_racing_a_membership_change_answers_cleanly()
    {
        var adminEmail = $"lock-admin-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(adminEmail, UniqueUsername("LAdm"));
        await PromoteToAdminAsync(adminEmail);
        var adminToken = await LoginAsync(adminEmail);
        var observed = new List<int>();

        for (var round = 0; round < 8; round++)
        {
            var victimEmail = $"lock-victim-{Guid.NewGuid():N}@example.test";
            var mateEmail = $"lock-mate-{Guid.NewGuid():N}@example.test";
            var victimUsername = UniqueUsername("LVic");
            await RegisterAndVerifyAsync(victimEmail, victimUsername);
            await RegisterAndVerifyAsync(mateEmail, UniqueUsername("LMat"));

            await using var database = CreateContext();
            var victim = await database.Users.AsNoTracking().SingleAsync(item => item.NormalizedEmail == victimEmail.ToUpperInvariant());
            var mate = await database.Users.AsNoTracking().SingleAsync(item => item.NormalizedEmail == mateEmail.ToUpperInvariant());
            var orgId = await CreateOrganizationAsync(adminToken, $"Lock Club {Guid.NewGuid():N}", victim.Id);
            using var addMate = await SendAuthorizedAsync(HttpMethod.Post, $"/api/organizations/{orgId:D}/members", adminToken, new
            {
                userId = mate.Id,
                role = OrganizationRoles.Organizer
            });
            Assert.Equal(HttpStatusCode.Created, addMate.StatusCode);

            // The closure locks the membership rows to drop them and the user row to anonymize it;
            // the removal locks the same rows to drop the member and derive their role.
            var closure = SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/users/{victim.Id:D}/disable", adminToken, new
            {
                confirmedUsername = victimUsername
            });
            var removal = SendAuthorizedAsync(HttpMethod.Delete, $"/api/organizations/{orgId:D}/members/{victim.Id:D}", adminToken);
            var responses = await Task.WhenAll(closure, removal);

            foreach (var response in responses)
            {
                var status = (int)response.StatusCode;
                observed.Add(status);
                var body = await response.Content.ReadAsStringAsync();
                Assert.True(status < 500, $"Expected a mapped answer, got {status}: {body}");
                if (!response.IsSuccessStatusCode)
                {
                    // Every refusal is a problem document with a code of its own, not a leaked abort.
                    var code = JsonDocument.Parse(body).RootElement.GetProperty("code").GetString();
                    Assert.False(string.IsNullOrEmpty(code));
                    Assert.NotEqual("internal_error", code);
                }
                response.Dispose();
            }

            // Whichever side won, the account ends closed, memberless and demoted, and the
            // organization keeps the member that inherited it.
            database.ChangeTracker.Clear();
            Assert.NotNull(await database.UserProfiles.AsNoTracking()
                .Where(item => item.UserId == victim.Id)
                .Select(item => item.ClosedAt)
                .SingleAsync());
            Assert.Equal(GlobalRoles.User, await GlobalRoleAsync(victim.Id));
            Assert.Empty(await database.OrganizationMembers.AsNoTracking().Where(item => item.UserId == victim.Id).ToListAsync());
            Assert.Equal(GlobalRoles.Organizer, await GlobalRoleAsync(mate.Id));
            Assert.Equal(mate.Id, await database.OrganizationMembers.AsNoTracking()
                .Where(item => item.OrganizationId == orgId)
                .Select(item => item.UserId)
                .SingleAsync());
        }

        Assert.Equal(16, observed.Count);
    }

    /// <summary>
    /// Creates the organization and hands it to the account the test cares about. Since ADR 0041 the
    /// creating admin is its first member, so the admin steps back out afterwards and the roster is
    /// exactly the one member named here.
    /// </summary>
    private async Task<Guid> CreateOrganizationAsync(string adminToken, string name, Guid memberUserId)
    {
        using var response = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/organizations", adminToken, new { name });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var organizationId = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();

        using var add = await SendAuthorizedAsync(HttpMethod.Post, $"/api/organizations/{organizationId:D}/members", adminToken, new
        {
            userId = memberUserId,
            role = OrganizationRoles.Organizer
        });
        Assert.Equal(HttpStatusCode.Created, add.StatusCode);

        await using var database = CreateContext();
        var creators = await database.OrganizationMembers.AsNoTracking()
            .Where(item => item.OrganizationId == organizationId && item.UserId != memberUserId)
            .Select(item => item.UserId)
            .ToListAsync();
        foreach (var creatorUserId in creators)
        {
            using var remove = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/organizations/{organizationId:D}/members/{creatorUserId:D}", adminToken);
            Assert.Equal(HttpStatusCode.NoContent, remove.StatusCode);
        }

        return organizationId;
    }

    /// <summary>By id, not by email: a closed account no longer carries the address it signed up with.</summary>
    private async Task<string> GlobalRoleAsync(Guid userId)
    {
        await using var database = CreateContext();
        return await database.Users.AsNoTracking()
            .Where(item => item.Id == userId)
            .Select(item => item.GlobalRole)
            .SingleAsync();
    }

    private async Task<int> AuditCountAsync(string action, Guid subjectUserId)
    {
        await using var database = CreateContext();
        return await database.AuditRecords.AsNoTracking()
            .CountAsync(item => item.Action == action && item.EntityId == subjectUserId.ToString("D"));
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
        using var registration = await Client.PostAsJsonAsync("/api/auth/register", new
        {
            email,
            username,
            password = "valid-password-value",
            firstName = "Test",
            lastName = "User"
        });
        Assert.Equal(HttpStatusCode.Accepted, registration.StatusCode);
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

    private static string UniqueUsername(string prefix) => $"{prefix}{Guid.NewGuid():N}"[..12];

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");

    private GonesDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GonesDbContext>()
            .UseNpgsql(postgres.GetConnectionString(), npgsql => npgsql.UseNodaTime())
            .Options;
        return new GonesDbContext(options);
    }
}
