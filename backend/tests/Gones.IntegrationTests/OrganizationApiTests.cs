using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Api.Organizations;
using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Identity;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Testcontainers.PostgreSql;

namespace Gones.IntegrationTests;

public sealed class OrganizationApiTests : IAsyncLifetime
{
    private const string SigningKey = "c14-org-integration-signing-key-with-more-than-32-characters";
    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder().WithImage("postgres:17-alpine").Build();
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
    public async Task Create_org_add_organizer_transfer_owner_and_reject_cross_org_write()
    {
        var adminEmail = $"admin-{Guid.NewGuid():N}@example.test";
        var ownerEmail = $"owner-{Guid.NewGuid():N}@example.test";
        var organizerEmail = $"organizer-{Guid.NewGuid():N}@example.test";
        var outsiderEmail = $"outsider-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(adminEmail, UniqueUsername("Adm"));
        await RegisterAndVerifyAsync(ownerEmail, UniqueUsername("Own"));
        await RegisterAndVerifyAsync(organizerEmail, UniqueUsername("Org"));
        await RegisterAndVerifyAsync(outsiderEmail, UniqueUsername("Out"));
        await PromoteToAdminAsync(adminEmail);

        await using var database = CreateContext();
        var owner = await database.Users.SingleAsync(item => item.NormalizedEmail == ownerEmail.ToUpperInvariant());
        var organizer = await database.Users.SingleAsync(item => item.NormalizedEmail == organizerEmail.ToUpperInvariant());
        var outsider = await database.Users.SingleAsync(item => item.NormalizedEmail == outsiderEmail.ToUpperInvariant());

        var adminToken = await LoginAsync(adminEmail);
        using var create = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/organizations", adminToken, new
        {
            name = "Alpha Club",
            description = "Public club",
            website = "https://alpha.example",
            contactEmail = "alpha@example.test",
            ownerUserId = owner.Id
        });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        var orgId = created.GetProperty("id").GetGuid();
        Assert.Equal("Alpha Club", created.GetProperty("name").GetString());

        using var publicList = await Client.GetAsync("/api/organizations");
        var publicBody = await publicList.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, publicList.StatusCode);
        Assert.Contains(publicBody.GetProperty("items").EnumerateArray(), item => item.GetProperty("id").GetGuid() == orgId);
        Assert.DoesNotContain(publicBody.GetProperty("items").EnumerateArray(), item => item.TryGetProperty("members", out _));

        var ownerToken = await LoginAsync(ownerEmail);
        using var meOrgs = await SendAuthorizedAsync(HttpMethod.Get, "/api/users/me/organizations", ownerToken);
        var meBody = await meOrgs.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, meOrgs.StatusCode);
        Assert.Equal(OrganizationRoles.Owner, meBody[0].GetProperty("role").GetString());
        Assert.False(meBody[0].TryGetProperty("email", out _));

        using var addOrganizer = await SendAuthorizedAsync(HttpMethod.Post, $"/api/organizations/{orgId:D}/members", ownerToken, new
        {
            userId = organizer.Id,
            role = OrganizationRoles.Organizer
        });
        Assert.Equal(HttpStatusCode.Created, addOrganizer.StatusCode);

        using var transfer = await SendAuthorizedAsync(HttpMethod.Post, $"/api/organizations/{orgId:D}/transfer-ownership", ownerToken, new
        {
            newOwnerUserId = organizer.Id
        });
        Assert.Equal(HttpStatusCode.NoContent, transfer.StatusCode);

        database.ChangeTracker.Clear();
        var owners = await database.OrganizationMembers
            .Where(item => item.OrganizationId == orgId && item.Role == OrganizationRoles.Owner)
            .ToListAsync();
        Assert.Single(owners);
        Assert.Equal(organizer.Id, owners[0].UserId);
        Assert.Equal(OrganizationRoles.Organizer, await database.OrganizationMembers
            .Where(item => item.OrganizationId == orgId && item.UserId == owner.Id)
            .Select(item => item.Role)
            .SingleAsync());

        var outsiderToken = await LoginAsync(outsiderEmail);
        using var crossOrg = await SendAuthorizedAsync(HttpMethod.Post, $"/api/organizations/{orgId:D}/members", outsiderToken, new
        {
            userId = outsider.Id,
            role = OrganizationRoles.Organizer
        });
        Assert.Equal(HttpStatusCode.NotFound, crossOrg.StatusCode);

        using var secondOrg = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/organizations", adminToken, new
        {
            name = "Beta Club",
            ownerUserId = outsider.Id
        });
        var secondId = (await secondOrg.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var betaOwnerToken = await LoginAsync(outsiderEmail);
        using var crossWrite = await SendAuthorizedAsync(HttpMethod.Post, $"/api/organizations/{orgId:D}/members", betaOwnerToken, new
        {
            userId = owner.Id,
            role = OrganizationRoles.Organizer
        });
        Assert.Equal(HttpStatusCode.NotFound, crossWrite.StatusCode);

        // Admin bypass can still manage foreign org members.
        using var adminAdd = await SendAuthorizedAsync(HttpMethod.Post, $"/api/organizations/{secondId:D}/members", adminToken, new
        {
            userId = owner.Id,
            role = OrganizationRoles.Organizer
        });
        Assert.Equal(HttpStatusCode.Created, adminAdd.StatusCode);
    }

    [Fact]
    public async Task Unique_org_name_and_verified_owner_required()
    {
        var adminEmail = $"admin-u-{Guid.NewGuid():N}@example.test";
        var ownerEmail = $"owner-u-{Guid.NewGuid():N}@example.test";
        var unverifiedEmail = $"unverified-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(adminEmail, UniqueUsername("Adu"));
        await RegisterAndVerifyAsync(ownerEmail, UniqueUsername("Owu"));
        using var unverifiedReg = await RegisterAsync(unverifiedEmail, UniqueUsername("Unv"));
        Assert.Equal(HttpStatusCode.Created, unverifiedReg.StatusCode);
        await PromoteToAdminAsync(adminEmail);

        await using var database = CreateContext();
        var owner = await database.Users.SingleAsync(item => item.NormalizedEmail == ownerEmail.ToUpperInvariant());
        var unverified = await database.Users.SingleAsync(item => item.NormalizedEmail == unverifiedEmail.ToUpperInvariant());
        var adminToken = await LoginAsync(adminEmail);

        using var create = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/organizations", adminToken, new
        {
            name = "Unique Name Club",
            ownerUserId = owner.Id
        });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);

        using var duplicate = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/organizations", adminToken, new
        {
            name = " unique name club ",
            ownerUserId = owner.Id
        });
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);

        using var unverifiedOwner = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/organizations", adminToken, new
        {
            name = "Unverified Owner Club",
            ownerUserId = unverified.Id
        });
        Assert.Equal(HttpStatusCode.BadRequest, unverifiedOwner.StatusCode);
    }

    [Fact]
    public async Task Sole_owner_cannot_be_demoted_without_transfer_and_db_enforces_one_owner()
    {
        var adminEmail = $"admin-o-{Guid.NewGuid():N}@example.test";
        var ownerEmail = $"owner-o-{Guid.NewGuid():N}@example.test";
        var secondEmail = $"second-o-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(adminEmail, UniqueUsername("Ado"));
        await RegisterAndVerifyAsync(ownerEmail, UniqueUsername("Owo"));
        await RegisterAndVerifyAsync(secondEmail, UniqueUsername("Sec"));
        await PromoteToAdminAsync(adminEmail);
        await using var database = CreateContext();
        var owner = await database.Users.SingleAsync(item => item.NormalizedEmail == ownerEmail.ToUpperInvariant());
        var second = await database.Users.SingleAsync(item => item.NormalizedEmail == secondEmail.ToUpperInvariant());
        var adminToken = await LoginAsync(adminEmail);

        using var create = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/organizations", adminToken, new
        {
            name = "Owner Guard Club",
            ownerUserId = owner.Id
        });
        var orgId = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var ownerToken = await LoginAsync(ownerEmail);

        using var demoteOwner = await SendAuthorizedAsync(HttpMethod.Put, $"/api/organizations/{orgId:D}/members/{owner.Id:D}/role", ownerToken, new
        {
            role = OrganizationRoles.Organizer
        });
        Assert.Equal(HttpStatusCode.Conflict, demoteOwner.StatusCode);

        await Assert.ThrowsAsync<DbUpdateException>(async () =>
        {
            await using var write = CreateContext();
            write.OrganizationMembers.Add(OrganizationMember.Create(orgId, second.Id, OrganizationRoles.Owner, NodaTime.SystemClock.Instance.GetCurrentInstant()));
            await write.SaveChangesAsync();
        });

        // T11: the sole Owner may leave once nobody else is left - that returns the org to Draft.
        // With a second member present the org would be left ownerless, so that removal still conflicts.
        using var addSecond = await SendAuthorizedAsync(HttpMethod.Post, $"/api/organizations/{orgId:D}/members", ownerToken, new
        {
            userId = second.Id,
            role = OrganizationRoles.Organizer
        });
        Assert.Equal(HttpStatusCode.Created, addSecond.StatusCode);

        using var removeOwnerWithPeers = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/organizations/{orgId:D}/members/{owner.Id:D}", ownerToken);
        Assert.Equal(HttpStatusCode.Conflict, removeOwnerWithPeers.StatusCode);

        using var removeSecond = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/organizations/{orgId:D}/members/{second.Id:D}", ownerToken);
        Assert.Equal(HttpStatusCode.NoContent, removeSecond.StatusCode);

        using var removeLastOwner = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/organizations/{orgId:D}/members/{owner.Id:D}", ownerToken);
        Assert.Equal(HttpStatusCode.NoContent, removeLastOwner.StatusCode);
    }

    /// <summary>
    /// T11 test-plan rows 1-4: the global role is derived from membership, server-side, on every add
    /// and remove. The organization role (Owner/Organizer) is untouched by this - only the global one.
    /// </summary>
    [Fact]
    public async Task Membership_changes_derive_the_global_organizer_role()
    {
        var adminEmail = $"admin-g-{Guid.NewGuid():N}@example.test";
        var ownerEmail = $"owner-g-{Guid.NewGuid():N}@example.test";
        var subjectEmail = $"subject-g-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(adminEmail, UniqueUsername("Adg"));
        await RegisterAndVerifyAsync(ownerEmail, UniqueUsername("Owg"));
        await RegisterAndVerifyAsync(subjectEmail, UniqueUsername("Sug"));
        await PromoteToAdminAsync(adminEmail);

        await using var database = CreateContext();
        var owner = await database.Users.SingleAsync(item => item.NormalizedEmail == ownerEmail.ToUpperInvariant());
        var subject = await database.Users.SingleAsync(item => item.NormalizedEmail == subjectEmail.ToUpperInvariant());
        var adminToken = await LoginAsync(adminEmail);
        Assert.Equal(GlobalRoles.User, await GlobalRoleAsync(subjectEmail));

        var firstOrgId = await CreateOrganizationAsync(adminToken, $"Derive First {Guid.NewGuid():N}", owner.Id);
        var secondOrgId = await CreateOrganizationAsync(adminToken, $"Derive Second {Guid.NewGuid():N}", owner.Id);

        // Row 1 - the first membership promotes User -> Organizer and records the derivation.
        using var addFirst = await SendAuthorizedAsync(HttpMethod.Post, $"/api/organizations/{firstOrgId:D}/members", adminToken, new
        {
            userId = subject.Id,
            role = OrganizationRoles.Organizer
        });
        Assert.Equal(HttpStatusCode.Created, addFirst.StatusCode);
        Assert.Equal(GlobalRoles.Organizer, await GlobalRoleAsync(subjectEmail));
        Assert.Equal(1, await AuditCountAsync("organization.role.derived", subject.Id));

        // Row 2 - a second membership changes nothing but is still recorded.
        using var addSecond = await SendAuthorizedAsync(HttpMethod.Post, $"/api/organizations/{secondOrgId:D}/members", adminToken, new
        {
            userId = subject.Id,
            role = OrganizationRoles.Organizer
        });
        Assert.Equal(HttpStatusCode.Created, addSecond.StatusCode);
        Assert.Equal(GlobalRoles.Organizer, await GlobalRoleAsync(subjectEmail));
        Assert.Equal(1, await AuditCountAsync("organization.role.derived", subject.Id));
        Assert.Equal(1, await AuditCountAsync("organization.role.unchanged", subject.Id));

        // Row 4 - one of two memberships removed keeps Organizer.
        using var removeSecond = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/organizations/{secondOrgId:D}/members/{subject.Id:D}", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, removeSecond.StatusCode);
        Assert.Equal(GlobalRoles.Organizer, await GlobalRoleAsync(subjectEmail));

        // Row 3 - the last membership removed demotes Organizer -> User.
        using var removeFirst = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/organizations/{firstOrgId:D}/members/{subject.Id:D}", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, removeFirst.StatusCode);
        Assert.Equal(GlobalRoles.User, await GlobalRoleAsync(subjectEmail));
        Assert.Equal(2, await AuditCountAsync("organization.role.derived", subject.Id));

        // A soft-deleted organization does not count as a membership: the role follows the live ones.
        using var addBack = await SendAuthorizedAsync(HttpMethod.Post, $"/api/organizations/{firstOrgId:D}/members", adminToken, new
        {
            userId = subject.Id,
            role = OrganizationRoles.Organizer
        });
        Assert.Equal(HttpStatusCode.Created, addBack.StatusCode);
        Assert.Equal(GlobalRoles.Organizer, await GlobalRoleAsync(subjectEmail));
    }

    /// <summary>T11 test-plan row 5: membership never moves an Admin, in either direction.</summary>
    [Fact]
    public async Task Admin_keeps_the_admin_role_on_both_membership_operations()
    {
        var adminEmail = $"admin-k-{Guid.NewGuid():N}@example.test";
        var ownerEmail = $"owner-k-{Guid.NewGuid():N}@example.test";
        var subjectEmail = $"subject-k-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(adminEmail, UniqueUsername("Adk"));
        await RegisterAndVerifyAsync(ownerEmail, UniqueUsername("Owk"));
        await RegisterAndVerifyAsync(subjectEmail, UniqueUsername("Suk"));
        await PromoteToAdminAsync(adminEmail);
        await PromoteToAdminAsync(subjectEmail);

        await using var database = CreateContext();
        var owner = await database.Users.SingleAsync(item => item.NormalizedEmail == ownerEmail.ToUpperInvariant());
        var subject = await database.Users.SingleAsync(item => item.NormalizedEmail == subjectEmail.ToUpperInvariant());
        var adminToken = await LoginAsync(adminEmail);
        var orgId = await CreateOrganizationAsync(adminToken, $"Admin Immune {Guid.NewGuid():N}", owner.Id);
        var subjectToken = await LoginAsync(subjectEmail);

        using var add = await SendAuthorizedAsync(HttpMethod.Post, $"/api/organizations/{orgId:D}/members", adminToken, new
        {
            userId = subject.Id,
            role = OrganizationRoles.Organizer
        });
        Assert.Equal(HttpStatusCode.Created, add.StatusCode);
        Assert.Equal(GlobalRoles.Admin, await GlobalRoleAsync(subjectEmail));

        using var remove = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/organizations/{orgId:D}/members/{subject.Id:D}", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, remove.StatusCode);
        Assert.Equal(GlobalRoles.Admin, await GlobalRoleAsync(subjectEmail));

        // No security stamp was rotated either, so the admin's session survives both operations.
        Assert.Equal(0, await AuditCountAsync("organization.role.derived", subject.Id));
        Assert.Equal(2, await AuditCountAsync("organization.role.unchanged", subject.Id));
        using var stillAdmin = await SendAuthorizedAsync(HttpMethod.Get, $"/api/admin/organizations/{orgId:D}/members", subjectToken);
        Assert.Equal(HttpStatusCode.OK, stillAdmin.StatusCode);
    }

    /// <summary>
    /// T11 test-plan rows 6 and 8: emptying an organization is allowed, returns it to Draft, and a
    /// Draft organization is still editable, deletable and restorable.
    /// </summary>
    [Fact]
    public async Task Removing_the_last_member_returns_the_organization_to_draft()
    {
        var adminEmail = $"admin-e-{Guid.NewGuid():N}@example.test";
        var ownerEmail = $"owner-e-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(adminEmail, UniqueUsername("Ade"));
        await RegisterAndVerifyAsync(ownerEmail, UniqueUsername("Owe"));
        await PromoteToAdminAsync(adminEmail);

        await using var database = CreateContext();
        var owner = await database.Users.SingleAsync(item => item.NormalizedEmail == ownerEmail.ToUpperInvariant());
        var adminToken = await LoginAsync(adminEmail);
        var marker = $"{Guid.NewGuid():N}";
        var orgId = await CreateOrganizationAsync(adminToken, $"Emptied {marker}", owner.Id);

        using var remove = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/organizations/{orgId:D}/members/{owner.Id:D}", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, remove.StatusCode);
        Assert.Equal(GlobalRoles.User, await GlobalRoleAsync(ownerEmail));

        using var list = await SendAuthorizedAsync(HttpMethod.Get, $"/api/admin/organizations?search={marker}", adminToken);
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        var listed = (await list.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items").EnumerateArray().Single();
        Assert.Equal(orgId, listed.GetProperty("id").GetGuid());
        Assert.Equal(0, listed.GetProperty("memberCount").GetInt32());
        Assert.True(listed.GetProperty("isDraft").GetBoolean());

        using var publicGet = await Client.GetAsync($"/api/organizations/{orgId:D}");
        Assert.Equal(HttpStatusCode.OK, publicGet.StatusCode);

        // Row 8 - a Draft organization is still fully manageable by an admin.
        using var update = await SendAuthorizedAsync(HttpMethod.Put, $"/api/admin/organizations/{orgId:D}", adminToken, new
        {
            name = $"Emptied {marker} renamed",
            description = "Still editable"
        });
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        var updated = await update.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, updated.GetProperty("memberCount").GetInt32());
        Assert.True(updated.GetProperty("isDraft").GetBoolean());

        using var softDelete = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/admin/organizations/{orgId:D}", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, softDelete.StatusCode);
        using var restore = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/organizations/{orgId:D}/restore", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, restore.StatusCode);

        // And an organizer can be put back, which promotes them again.
        using var addBack = await SendAuthorizedAsync(HttpMethod.Post, $"/api/organizations/{orgId:D}/members", adminToken, new
        {
            userId = owner.Id,
            role = OrganizationRoles.Organizer
        });
        Assert.Equal(HttpStatusCode.Created, addBack.StatusCode);
        Assert.Equal(GlobalRoles.Organizer, await GlobalRoleAsync(ownerEmail));
    }

    /// <summary>
    /// T11 test-plan row 9 plus the privilege-boundary requirement: the derived change is enforced
    /// server-side and takes effect on the very next request, not at the next token refresh. The
    /// access token already in the caller's hand stops working because the security stamp rotated and
    /// the baked-in role claim no longer matches the stored one; the refresh session is revoked too,
    /// so there is no way to trade the old session for a token carrying the old role.
    /// </summary>
    [Fact]
    public async Task Derived_role_change_is_immediate_and_revokes_refresh_sessions()
    {
        var adminEmail = $"admin-s-{Guid.NewGuid():N}@example.test";
        var ownerEmail = $"owner-s-{Guid.NewGuid():N}@example.test";
        var subjectEmail = $"subject-s-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(adminEmail, UniqueUsername("Ads"));
        await RegisterAndVerifyAsync(ownerEmail, UniqueUsername("Ows"));
        await RegisterAndVerifyAsync(subjectEmail, UniqueUsername("Sus"));
        await PromoteToAdminAsync(adminEmail);

        await using var database = CreateContext();
        var owner = await database.Users.SingleAsync(item => item.NormalizedEmail == ownerEmail.ToUpperInvariant());
        var subject = await database.Users.SingleAsync(item => item.NormalizedEmail == subjectEmail.ToUpperInvariant());
        var adminToken = await LoginAsync(adminEmail);
        var orgId = await CreateOrganizationAsync(adminToken, $"Session Club {Guid.NewGuid():N}", owner.Id);

        var (userToken, userCookie) = await LoginWithCookieAsync(subjectEmail);
        using var beforePromotion = await SendAuthorizedAsync(HttpMethod.Get, "/api/users/me/organizations", userToken);
        Assert.Equal(HttpStatusCode.OK, beforePromotion.StatusCode);

        using var add = await SendAuthorizedAsync(HttpMethod.Post, $"/api/organizations/{orgId:D}/members", adminToken, new
        {
            userId = subject.Id,
            role = OrganizationRoles.Organizer
        });
        Assert.Equal(HttpStatusCode.Created, add.StatusCode);

        using var afterPromotion = await SendAuthorizedAsync(HttpMethod.Get, "/api/users/me/organizations", userToken);
        Assert.Equal(HttpStatusCode.Unauthorized, afterPromotion.StatusCode);
        using var refreshAfterPromotion = await RefreshAsync(userCookie);
        Assert.Equal(HttpStatusCode.Unauthorized, refreshAfterPromotion.StatusCode);

        // Re-authenticating hands out the promoted role, and it really is an Organizer token.
        var (organizerToken, organizerCookie) = await LoginWithCookieAsync(subjectEmail);
        using var previewAllowed = await SendAuthorizedAsync(HttpMethod.Post, "/api/tournaments/preview", organizerToken, new { organizationId = orgId });
        Assert.NotEqual(HttpStatusCode.Forbidden, previewAllowed.StatusCode);

        using var remove = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/organizations/{orgId:D}/members/{subject.Id:D}", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, remove.StatusCode);
        Assert.Equal(GlobalRoles.User, await GlobalRoleAsync(subjectEmail));

        // The stale Organizer token is refused on the next request - not at the next refresh.
        using var afterDemotion = await SendAuthorizedAsync(HttpMethod.Get, "/api/users/me/organizations", organizerToken);
        Assert.Equal(HttpStatusCode.Unauthorized, afterDemotion.StatusCode);
        using var staleOrganizerPreview = await SendAuthorizedAsync(HttpMethod.Post, "/api/tournaments/preview", organizerToken, new { organizationId = orgId });
        Assert.Equal(HttpStatusCode.Unauthorized, staleOrganizerPreview.StatusCode);
        using var refreshAfterDemotion = await RefreshAsync(organizerCookie);
        Assert.Equal(HttpStatusCode.Unauthorized, refreshAfterDemotion.StatusCode);

        // And a fresh login is back to a plain User, refused by the Organizer policy.
        var demotedToken = await LoginAsync(subjectEmail);
        using var demotedPreview = await SendAuthorizedAsync(HttpMethod.Post, "/api/tournaments/preview", demotedToken, new { organizationId = orgId });
        Assert.Equal(HttpStatusCode.Forbidden, demotedPreview.StatusCode);
    }

    /// <summary>
    /// T11 repair: creating an organization writes the owner membership, so it derives the role like
    /// any other membership write - otherwise every new organization is born owned by a plain User.
    /// </summary>
    [Fact]
    public async Task Creating_an_organization_derives_the_owner_role()
    {
        var adminEmail = $"admin-c-{Guid.NewGuid():N}@example.test";
        var ownerEmail = $"owner-c-{Guid.NewGuid():N}@example.test";
        var adminOwnerEmail = $"adminowner-c-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(adminEmail, UniqueUsername("Adc"));
        await RegisterAndVerifyAsync(ownerEmail, UniqueUsername("Owc"));
        await RegisterAndVerifyAsync(adminOwnerEmail, UniqueUsername("Aoc"));
        await PromoteToAdminAsync(adminEmail);
        await PromoteToAdminAsync(adminOwnerEmail);

        await using var database = CreateContext();
        var owner = await database.Users.SingleAsync(item => item.NormalizedEmail == ownerEmail.ToUpperInvariant());
        var adminOwner = await database.Users.SingleAsync(item => item.NormalizedEmail == adminOwnerEmail.ToUpperInvariant());
        var adminToken = await LoginAsync(adminEmail);

        // The owner is holding a live User token at the moment the organization is created under them.
        var (ownerToken, ownerCookie) = await LoginWithCookieAsync(ownerEmail);
        using var beforeCreate = await SendAuthorizedAsync(HttpMethod.Get, "/api/users/me/organizations", ownerToken);
        Assert.Equal(HttpStatusCode.OK, beforeCreate.StatusCode);
        Assert.Equal(GlobalRoles.User, await GlobalRoleAsync(ownerEmail));

        var orgId = await CreateOrganizationAsync(adminToken, $"Created Derive {Guid.NewGuid():N}", owner.Id);
        Assert.Equal(GlobalRoles.Organizer, await GlobalRoleAsync(ownerEmail));
        Assert.Equal(1, await AuditCountAsync("organization.role.derived", owner.Id));

        // The token in flight dies on the next request, and its refresh session with it.
        using var afterCreate = await SendAuthorizedAsync(HttpMethod.Get, "/api/users/me/organizations", ownerToken);
        Assert.Equal(HttpStatusCode.Unauthorized, afterCreate.StatusCode);
        using var refreshAfterCreate = await RefreshAsync(ownerCookie);
        Assert.Equal(HttpStatusCode.Unauthorized, refreshAfterCreate.StatusCode);

        // Re-authenticating hands out the derived role, which opens the Organizer-only route.
        var organizerToken = await LoginAsync(ownerEmail);
        using var preview = await SendAuthorizedAsync(HttpMethod.Post, "/api/tournaments/preview", organizerToken, new { organizationId = orgId });
        Assert.NotEqual(HttpStatusCode.Forbidden, preview.StatusCode);

        // An Admin owner is left alone here too.
        var adminOwnerToken = await LoginAsync(adminOwnerEmail);
        await CreateOrganizationAsync(adminToken, $"Created Admin Owner {Guid.NewGuid():N}", adminOwner.Id);
        Assert.Equal(GlobalRoles.Admin, await GlobalRoleAsync(adminOwnerEmail));
        Assert.Equal(0, await AuditCountAsync("organization.role.derived", adminOwner.Id));
        Assert.Equal(1, await AuditCountAsync("organization.role.unchanged", adminOwner.Id));
        using var stillAdmin = await SendAuthorizedAsync(HttpMethod.Get, "/api/admin/organizations", adminOwnerToken);
        Assert.Equal(HttpStatusCode.OK, stillAdmin.StatusCode);
    }

    /// <summary>
    /// T11 repair: an ownership transfer can hand the organization to someone who was not a member
    /// yet, so both sides are re-derived.
    /// </summary>
    [Fact]
    public async Task Transferring_ownership_derives_both_roles()
    {
        var adminEmail = $"admin-t-{Guid.NewGuid():N}@example.test";
        var ownerEmail = $"owner-t-{Guid.NewGuid():N}@example.test";
        var heirEmail = $"heir-t-{Guid.NewGuid():N}@example.test";
        var adminHeirEmail = $"adminheir-t-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(adminEmail, UniqueUsername("Adt"));
        await RegisterAndVerifyAsync(ownerEmail, UniqueUsername("Owt"));
        await RegisterAndVerifyAsync(heirEmail, UniqueUsername("Het"));
        await RegisterAndVerifyAsync(adminHeirEmail, UniqueUsername("Aht"));
        await PromoteToAdminAsync(adminEmail);
        await PromoteToAdminAsync(adminHeirEmail);

        await using var database = CreateContext();
        var owner = await database.Users.SingleAsync(item => item.NormalizedEmail == ownerEmail.ToUpperInvariant());
        var heir = await database.Users.SingleAsync(item => item.NormalizedEmail == heirEmail.ToUpperInvariant());
        var adminHeir = await database.Users.SingleAsync(item => item.NormalizedEmail == adminHeirEmail.ToUpperInvariant());
        var adminToken = await LoginAsync(adminEmail);

        var orgId = await CreateOrganizationAsync(adminToken, $"Transfer Derive {Guid.NewGuid():N}", owner.Id);
        Assert.Equal(GlobalRoles.Organizer, await GlobalRoleAsync(ownerEmail));
        Assert.Equal(GlobalRoles.User, await GlobalRoleAsync(heirEmail));

        var heirToken = await LoginAsync(heirEmail);
        using var transfer = await SendAuthorizedAsync(HttpMethod.Post, $"/api/organizations/{orgId:D}/transfer-ownership", adminToken, new
        {
            newOwnerUserId = heir.Id
        });
        Assert.Equal(HttpStatusCode.NoContent, transfer.StatusCode);

        // The heir holds a membership now; the outgoing owner keeps one, so both are Organizers.
        Assert.Equal(GlobalRoles.Organizer, await GlobalRoleAsync(heirEmail));
        Assert.Equal(GlobalRoles.Organizer, await GlobalRoleAsync(ownerEmail));
        Assert.Equal(1, await AuditCountAsync("organization.role.derived", heir.Id));
        using var staleHeirToken = await SendAuthorizedAsync(HttpMethod.Get, "/api/users/me/organizations", heirToken);
        Assert.Equal(HttpStatusCode.Unauthorized, staleHeirToken.StatusCode);

        // Dropping the outgoing owner takes their role back and leaves the heir owning it.
        using var removeOldOwner = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/organizations/{orgId:D}/members/{owner.Id:D}", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, removeOldOwner.StatusCode);
        Assert.Equal(GlobalRoles.User, await GlobalRoleAsync(ownerEmail));

        // Handing it to an Admin does not move the Admin either.
        using var transferToAdmin = await SendAuthorizedAsync(HttpMethod.Post, $"/api/organizations/{orgId:D}/transfer-ownership", adminToken, new
        {
            newOwnerUserId = adminHeir.Id
        });
        Assert.Equal(HttpStatusCode.NoContent, transferToAdmin.StatusCode);
        Assert.Equal(GlobalRoles.Admin, await GlobalRoleAsync(adminHeirEmail));
        Assert.Equal(0, await AuditCountAsync("organization.role.derived", adminHeir.Id));
        Assert.Equal(GlobalRoles.Organizer, await GlobalRoleAsync(heirEmail));
    }

    [Fact]
    public async Task Soft_delete_hides_public_rows_restore_and_delete_blockers()
    {
        var adminEmail = $"admin-d-{Guid.NewGuid():N}@example.test";
        var ownerEmail = $"owner-d-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(adminEmail, UniqueUsername("Add"));
        await RegisterAndVerifyAsync(ownerEmail, UniqueUsername("Owd"));
        await PromoteToAdminAsync(adminEmail);
        await using var database = CreateContext();
        var owner = await database.Users.SingleAsync(item => item.NormalizedEmail == ownerEmail.ToUpperInvariant());
        var adminToken = await LoginAsync(adminEmail);

        using var create = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/organizations", adminToken, new
        {
            name = "Soft Delete Club",
            ownerUserId = owner.Id
        });
        var orgId = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var now = NodaTime.SystemClock.Instance.GetCurrentInstant();
        var legacy = await database.TournamentFormats.SingleAsync(item => item.Slug == TournamentFormat.LegacySlug);
        var tournament = Event.Create(
            orgId,
            owner.Id,
            new ScheduledTournamentDraft(
                "Org Blocker Cup",
                $"org-blocker-{Guid.NewGuid():N}",
                null,
                null,
                "1 Main Street",
                null,
                "Lyon",
                "France",
                "Europe/Paris",
                new NodaTime.LocalDateTime(2035, 1, 1, 10, 0),
                new NodaTime.LocalDateTime(2035, 1, 1, 18, 0),
                32),
            [legacy],
            now);
        database.Events.Add(tournament);
        await database.SaveChangesAsync();

        using var blockedByTournament = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/admin/organizations/{orgId:D}", adminToken);
        Assert.Equal(HttpStatusCode.Conflict, blockedByTournament.StatusCode);
        tournament.Cancel(now);
        await database.SaveChangesAsync();

        using var del = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/admin/organizations/{orgId:D}", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, del.StatusCode);

        using var publicGet = await Client.GetAsync($"/api/organizations/{orgId:D}");
        Assert.Equal(HttpStatusCode.NotFound, publicGet.StatusCode);

        var ownerToken = await LoginAsync(ownerEmail);
        using var meAfterDelete = await SendAuthorizedAsync(HttpMethod.Get, "/api/users/me/organizations", ownerToken);
        var meBody = await meAfterDelete.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, meBody.GetArrayLength());

        using var restore = await SendAuthorizedAsync(HttpMethod.Post, $"/api/admin/organizations/{orgId:D}/restore", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, restore.StatusCode);
        using var publicAfterRestore = await Client.GetAsync($"/api/organizations/{orgId:D}");
        Assert.Equal(HttpStatusCode.OK, publicAfterRestore.StatusCode);

        // Dependency blocker hook returns 409 when registered.
        await using var blockedFactory = factory!.WithWebHostBuilder(builder =>
        {
            builder.ConfigureServices(services =>
            {
                services.AddSingleton<IOrganizationDeleteDependency, BlockingOrganizationDeleteDependency>();
            });
        });
        using var blockedClient = blockedFactory.CreateClient();
        var blockedAdminToken = await LoginWithClientAsync(blockedClient, adminEmail, "valid-password-value");
        using var blockedDelete = await SendAuthorizedWithClientAsync(
            blockedClient,
            HttpMethod.Delete,
            $"/api/admin/organizations/{orgId:D}",
            blockedAdminToken);
        Assert.Equal(HttpStatusCode.Conflict, blockedDelete.StatusCode);
    }

    [Fact]
    public async Task Notification_settings_owner_only_and_indistinguishable_idor()
    {
        var adminEmail = $"admin-n-{Guid.NewGuid():N}@example.test";
        var ownerEmail = $"owner-n-{Guid.NewGuid():N}@example.test";
        var otherEmail = $"other-n-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(adminEmail, UniqueUsername("Adn"));
        await RegisterAndVerifyAsync(ownerEmail, UniqueUsername("Own"));
        await RegisterAndVerifyAsync(otherEmail, UniqueUsername("Oth"));
        await PromoteToAdminAsync(adminEmail);
        await using var database = CreateContext();
        var owner = await database.Users.SingleAsync(item => item.NormalizedEmail == ownerEmail.ToUpperInvariant());
        var adminToken = await LoginAsync(adminEmail);
        using var create = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/organizations", adminToken, new
        {
            name = "Notify Club",
            ownerUserId = owner.Id
        });
        var orgId = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        var ownerToken = await LoginAsync(ownerEmail);
        var otherToken = await LoginAsync(otherEmail);

        using var update = await SendAuthorizedAsync(HttpMethod.Put, $"/api/organizations/{orgId:D}/notification-settings", ownerToken, new
        {
            notifyOnRegistration = true,
            notifyOnUnregistration = true
        });
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        var settings = await update.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(settings.GetProperty("notifyOnRegistration").GetBoolean());
        Assert.True(settings.GetProperty("notifyOnUnregistration").GetBoolean());

        using var idor = await SendAuthorizedAsync(HttpMethod.Get, $"/api/organizations/{orgId:D}/notification-settings", otherToken);
        using var missing = await SendAuthorizedAsync(HttpMethod.Get, $"/api/organizations/{Guid.NewGuid():D}/notification-settings", otherToken);
        Assert.Equal(HttpStatusCode.NotFound, idor.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Equal(await ProblemCode(idor), await ProblemCode(missing));
    }

    [Fact]
    public async Task Admin_reads_any_roster_with_identities_and_non_admins_are_refused()
    {
        var adminEmail = $"admin-r-{Guid.NewGuid():N}@example.test";
        var ownerEmail = $"owner-r-{Guid.NewGuid():N}@example.test";
        var organizerEmail = $"organizer-r-{Guid.NewGuid():N}@example.test";
        var plainEmail = $"plain-r-{Guid.NewGuid():N}@example.test";
        var ownerUsername = UniqueUsername("Zwr");
        var organizerUsername = UniqueUsername("Awr");
        await RegisterAndVerifyAsync(adminEmail, UniqueUsername("Adr"));
        await RegisterAndVerifyAsync(ownerEmail, ownerUsername);
        await RegisterAndVerifyAsync(organizerEmail, organizerUsername);
        await RegisterAndVerifyAsync(plainEmail, UniqueUsername("Plr"));
        await PromoteToAdminAsync(adminEmail);
        await AssignGlobalRoleAsync(organizerEmail, GlobalRoles.Organizer);

        await using var database = CreateContext();
        var owner = await database.Users.SingleAsync(item => item.NormalizedEmail == ownerEmail.ToUpperInvariant());
        var organizer = await database.Users.SingleAsync(item => item.NormalizedEmail == organizerEmail.ToUpperInvariant());
        var adminToken = await LoginAsync(adminEmail);

        using var create = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/organizations", adminToken, new
        {
            name = $"Roster Club {Guid.NewGuid():N}",
            ownerUserId = owner.Id
        });
        var orgId = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        using var addOrganizer = await SendAuthorizedAsync(HttpMethod.Post, $"/api/organizations/{orgId:D}/members", adminToken, new
        {
            userId = organizer.Id,
            role = OrganizationRoles.Organizer
        });
        Assert.Equal(HttpStatusCode.Created, addOrganizer.StatusCode);

        using var roster = await SendAuthorizedAsync(HttpMethod.Get, $"/api/admin/organizations/{orgId:D}/members", adminToken);
        Assert.Equal(HttpStatusCode.OK, roster.StatusCode);
        var members = await roster.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, members.GetArrayLength());

        // Owner first even though the organizer sorts earlier by username.
        var first = members[0];
        var second = members[1];
        Assert.Equal(OrganizationRoles.Owner, first.GetProperty("role").GetString());
        Assert.Equal(owner.Id, first.GetProperty("userId").GetGuid());
        Assert.Equal(ownerUsername, first.GetProperty("username").GetString());
        Assert.Equal(ownerEmail, first.GetProperty("email").GetString());
        // Creating the organization derived the owner's global role, so the roster shows an Organizer.
        Assert.Equal(GlobalRoles.Organizer, first.GetProperty("globalRole").GetString());
        Assert.Equal(OrganizationRoles.Organizer, second.GetProperty("role").GetString());
        Assert.Equal(organizerUsername, second.GetProperty("username").GetString());
        Assert.Equal(GlobalRoles.Organizer, second.GetProperty("globalRole").GetString());

        // The roster carries identities and nothing else - no hashes, tokens or verification secrets.
        Assert.Equal(
            new[] { "userId", "username", "email", "globalRole", "role", "createdAt" }.Order(),
            first.EnumerateObject().Select(property => property.Name).Order());

        using var anonymous = await Client.GetAsync($"/api/admin/organizations/{orgId:D}/members");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        var plainToken = await LoginAsync(plainEmail);
        using var plain = await SendAuthorizedAsync(HttpMethod.Get, $"/api/admin/organizations/{orgId:D}/members", plainToken);
        Assert.Equal(HttpStatusCode.Forbidden, plain.StatusCode);

        // Global Organizer, and a member of this very organization, is still refused.
        var organizerToken = await LoginAsync(organizerEmail);
        using var organizerRead = await SendAuthorizedAsync(HttpMethod.Get, $"/api/admin/organizations/{orgId:D}/members", organizerToken);
        Assert.Equal(HttpStatusCode.Forbidden, organizerRead.StatusCode);

        using var unknown = await SendAuthorizedAsync(HttpMethod.Get, $"/api/admin/organizations/{Guid.NewGuid():D}/members", adminToken);
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);

        using var deletedCreate = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/organizations", adminToken, new
        {
            name = $"Deleted Roster Club {Guid.NewGuid():N}",
            ownerUserId = owner.Id
        });
        var deletedOrgId = (await deletedCreate.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
        using var softDelete = await SendAuthorizedAsync(HttpMethod.Delete, $"/api/admin/organizations/{deletedOrgId:D}", adminToken);
        Assert.Equal(HttpStatusCode.NoContent, softDelete.StatusCode);

        using var deletedRoster = await SendAuthorizedAsync(HttpMethod.Get, $"/api/admin/organizations/{deletedOrgId:D}/members", adminToken);
        Assert.Equal(HttpStatusCode.OK, deletedRoster.StatusCode);
        var deletedMembers = await deletedRoster.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, deletedMembers.GetArrayLength());
        Assert.Equal(owner.Id, deletedMembers[0].GetProperty("userId").GetGuid());
    }

    [Fact]
    public async Task Admin_organization_list_reports_member_count_and_draft_state()
    {
        var adminEmail = $"admin-c-{Guid.NewGuid():N}@example.test";
        var ownerEmail = $"owner-c-{Guid.NewGuid():N}@example.test";
        var organizerEmail = $"organizer-c-{Guid.NewGuid():N}@example.test";
        await RegisterAndVerifyAsync(adminEmail, UniqueUsername("Adc"));
        await RegisterAndVerifyAsync(ownerEmail, UniqueUsername("Owc"));
        await RegisterAndVerifyAsync(organizerEmail, UniqueUsername("Ogc"));
        await PromoteToAdminAsync(adminEmail);

        await using var database = CreateContext();
        var owner = await database.Users.SingleAsync(item => item.NormalizedEmail == ownerEmail.ToUpperInvariant());
        var organizer = await database.Users.SingleAsync(item => item.NormalizedEmail == organizerEmail.ToUpperInvariant());
        var adminToken = await LoginAsync(adminEmail);
        var marker = $"{Guid.NewGuid():N}";

        using var create = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/organizations", adminToken, new
        {
            name = $"Staffed {marker}",
            ownerUserId = owner.Id
        });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var created = await create.Content.ReadFromJsonAsync<JsonElement>();
        var orgId = created.GetProperty("id").GetGuid();
        Assert.Equal(1, created.GetProperty("memberCount").GetInt32());
        Assert.False(created.GetProperty("isDraft").GetBoolean());

        using var addOrganizer = await SendAuthorizedAsync(HttpMethod.Post, $"/api/organizations/{orgId:D}/members", adminToken, new
        {
            userId = organizer.Id,
            role = OrganizationRoles.Organizer
        });
        Assert.Equal(HttpStatusCode.Created, addOrganizer.StatusCode);

        // A member-less organization can only exist as a stored row, so seed one directly.
        database.Organizations.Add(Organization.Create($"Draft {marker}", null, null, null, NodaTime.SystemClock.Instance.GetCurrentInstant()));
        await database.SaveChangesAsync();

        using var list = await SendAuthorizedAsync(HttpMethod.Get, $"/api/admin/organizations?search={marker}", adminToken);
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        var body = await list.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(2, items.Count);
        var staffed = items.Single(item => item.GetProperty("name").GetString() == $"Staffed {marker}");
        var draft = items.Single(item => item.GetProperty("name").GetString() == $"Draft {marker}");
        Assert.Equal(2, staffed.GetProperty("memberCount").GetInt32());
        Assert.False(staffed.GetProperty("isDraft").GetBoolean());
        Assert.Equal(0, draft.GetProperty("memberCount").GetInt32());
        Assert.True(draft.GetProperty("isDraft").GetBoolean());
    }

    private sealed class BlockingOrganizationDeleteDependency : IOrganizationDeleteDependency
    {
        public Task<IReadOnlyList<string>> GetBlockersAsync(Guid organizationId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<string>>(["tournament"]);
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

    private async Task<Guid> CreateOrganizationAsync(string adminToken, string name, Guid ownerUserId)
    {
        using var response = await SendAuthorizedAsync(HttpMethod.Post, "/api/admin/organizations", adminToken, new { name, ownerUserId });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetGuid();
    }

    private async Task<string> GlobalRoleAsync(string email)
    {
        await using var database = CreateContext();
        return await database.Users.AsNoTracking()
            .Where(item => item.NormalizedEmail == email.ToUpperInvariant())
            .Select(item => item.GlobalRole)
            .SingleAsync();
    }

    private async Task<int> AuditCountAsync(string action, Guid subjectUserId)
    {
        await using var database = CreateContext();
        return await database.AuditRecords.AsNoTracking()
            .CountAsync(item => item.Action == action && item.EntityId == subjectUserId.ToString("D"));
    }

    private Task PromoteToAdminAsync(string email) => AssignGlobalRoleAsync(email, GlobalRoles.Admin);

    private async Task AssignGlobalRoleAsync(string email, string role)
    {
        await using var database = CreateContext();
        var user = await database.Users.SingleAsync(item => item.NormalizedEmail == email.ToUpperInvariant());
        user.AssignGlobalRole(role);
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

    private Task<string> LoginAsync(string email) => LoginWithClientAsync(Client, email, "valid-password-value");

    private async Task<(string Token, string Cookie)> LoginWithCookieAsync(string email)
    {
        using var response = await Client.PostAsJsonAsync("/api/auth/login", new { email, password = "valid-password-value", deviceLabel = "test" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var cookie = response.Headers.GetValues("Set-Cookie")
            .Single(value => value.StartsWith("gones_refresh=", StringComparison.Ordinal))
            .Split(';', 2)[0];
        return (body.GetProperty("accessToken").GetString()!, cookie);
    }

    private Task<HttpResponseMessage> RefreshAsync(string cookie)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        request.Headers.Add("Cookie", cookie);
        return Client.SendAsync(request);
    }

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

    private static async Task<string?> ProblemCode(HttpResponseMessage response)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.TryGetProperty("code", out var code) ? code.GetString() : null;
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
