using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Api.Organizations;
using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Identity;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NodaTime;
using Testcontainers.PostgreSql;

namespace Gones.IntegrationTests;

public sealed class TournamentRegistrationApiTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder().WithImage("postgres:17-alpine").Build();
    private readonly MutableClock clock = new(Instant.FromUtc(2030, 1, 1, 12, 0));
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;
    private SeedRows seed = null!;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var database = CreateContext())
        {
            await database.Database.MigrateAsync();
            seed = await SeedAsync(database);
        }
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("GONES_DB_CONNECTION", postgres.GetConnectionString());
            builder.UseSetting("GONES_ALLOWED_ORIGINS", "https://app.example");
            builder.UseSetting("GONES_AUTH_SIGNING_KEY", "c23-registration-signing-key-more-than-32-characters");
            builder.UseSetting("GONES_PUBLIC_APP_ORIGIN", "https://app.example");
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IClock>();
                services.AddSingleton<IClock>(clock);
            });
        });
        client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
    }

    public async Task DisposeAsync()
    {
        client?.Dispose();
        if (factory is not null) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Register_rejects_unverified_blocked_full_duplicate_cancelled_deleted_and_started_with_stable_codes()
    {
        var open = await CreateTournamentAsync("Open Cup", 10);
        await AssertProblem(await RegisterAsync(open.Id, seed.Unverified.Id, "unverified"), HttpStatusCode.Forbidden, "email_verification_required");

        await using (var database = CreateContext())
        {
            database.OrganizationBlockedUsers.Add(OrganizationBlockedUser.Block(seed.Organization.Id, seed.Blocked.Id, clock.GetCurrentInstant()));
            database.TournamentRegistrationAttempts.Add(TournamentRegistrationAttempt.Register(open.Id, seed.Registered.Id, seed.Registered.Id, clock.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }
        await AssertProblem(await RegisterAsync(open.Id, seed.Blocked.Id, "blocked"), HttpStatusCode.Forbidden, "registration_blocked");
        await AssertProblem(await RegisterAsync(open.Id, seed.Registered.Id, "duplicate"), HttpStatusCode.Conflict, "registration_already_active");

        var full = await CreateTournamentAsync("Full Cup", 1);
        await using (var database = CreateContext())
        {
            database.TournamentRegistrationAttempts.Add(TournamentRegistrationAttempt.Register(full.Id, seed.Registered.Id, seed.Registered.Id, clock.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }
        await AssertProblem(await RegisterAsync(full.Id, seed.User.Id, "full"), HttpStatusCode.Conflict, "tournament_full");

        var cancelled = await CreateTournamentAsync("Cancelled Cup", 10);
        cancelled.Cancel(clock.GetCurrentInstant());
        var deleted = await CreateTournamentAsync("Deleted Cup", 10);
        deleted.SoftDelete(seed.Organizer.Id, "hidden", clock.GetCurrentInstant());
        await using (var database = CreateContext())
        {
            database.ScheduledTournaments.UpdateRange(cancelled, deleted);
            await database.SaveChangesAsync();
        }
        await AssertProblem(await RegisterAsync(cancelled.Id, seed.User.Id, "cancelled"), HttpStatusCode.Conflict, "tournament_not_open");
        await AssertProblem(await RegisterAsync(deleted.Id, seed.User.Id, "deleted"), HttpStatusCode.NotFound, "not_found");

        var started = await CreateTournamentAsync("Started Cup", 10);
        clock.Set(started.StartsAtUtc);
        await AssertProblem(await RegisterAsync(started.Id, seed.User.Id, "started"), HttpStatusCode.Conflict, "registration_closed");
    }

    [Fact]
    public async Task Register_unregister_retry_and_reregister_preserve_attempt_history_projection_mail_and_audit()
    {
        var tournament = await CreateTournamentAsync("History Cup", 10);
        await EnableOrganizerNoticesAsync();

        using var registered = await RegisterAsync(tournament.Id, seed.User.Id, "register-one");
        Assert.Equal(HttpStatusCode.Created, registered.StatusCode);
        using var sameRegister = await RegisterAsync(tournament.Id, seed.User.Id, "register-one");
        Assert.Equal(HttpStatusCode.Created, sameRegister.StatusCode);
        Assert.Equal(await registered.Content.ReadAsStringAsync(), await sameRegister.Content.ReadAsStringAsync());
        await AssertProblem(await RegisterAsync(tournament.Id, seed.User.Id, "register-two"), HttpStatusCode.Conflict, "registration_already_active");
        await using (var database = CreateContext())
        {
            var currentProfile = await database.UserProfiles.SingleAsync(item => item.UserId == seed.User.Id);
            currentProfile.Update("RenamedUser", "Current", "Private", "Lyon", 1990, "en", true, false, false, false, false, 2030, clock.GetCurrentInstant());
            await database.SaveChangesAsync();
        }

        using var publicParticipants = await Client.GetAsync($"/api/tournaments/{tournament.Slug}/participants");
        var participants = await publicParticipants.Content.ReadFromJsonAsync<JsonElement>();
        var participant = Assert.Single(participants.GetProperty("items").EnumerateArray());
        Assert.Equal("RenamedUser", participant.GetProperty("username").GetString());
        Assert.Equal("Current", participant.GetProperty("firstName").GetString());
        Assert.Equal(JsonValueKind.Null, participant.GetProperty("lastName").ValueKind);

        using var unregistered = await UnregisterAsync(tournament.Id, seed.User.Id, "unregister-one");
        Assert.Equal(HttpStatusCode.OK, unregistered.StatusCode);
        using var sameUnregister = await UnregisterAsync(tournament.Id, seed.User.Id, "unregister-one");
        Assert.Equal(HttpStatusCode.OK, sameUnregister.StatusCode);

        using var registeredAgain = await RegisterAsync(tournament.Id, seed.User.Id, "register-three");
        Assert.Equal(HttpStatusCode.Created, registeredAgain.StatusCode);
        using var historyResponse = await SendAsync(HttpMethod.Get, "/api/users/me/registrations?page=1&pageSize=20", seed.User.Id);
        Assert.Equal(HttpStatusCode.OK, historyResponse.StatusCode);
        var history = await historyResponse.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(2, history.GetProperty("totalCount").GetInt32());
        Assert.Equal("Confirmed", history.GetProperty("items")[0].GetProperty("status").GetString());
        Assert.Equal("CancelledByUser", history.GetProperty("items")[1].GetProperty("status").GetString());

        await using var verificationDatabase = CreateContext();
        var attempts = await verificationDatabase.TournamentRegistrationAttempts.Where(item => item.UserId == seed.User.Id).OrderBy(item => item.RegisteredAt).ToListAsync();
        Assert.Equal(2, attempts.Count);
        Assert.NotEqual(attempts[0].Id, attempts[1].Id);
        Assert.Equal(TournamentRegistrationStatus.CancelledByUser, attempts[0].Status);
        Assert.Equal(TournamentRegistrationStatus.Confirmed, attempts[1].Status);
        Assert.Equal(6, await verificationDatabase.NotificationOutboxRecords.CountAsync(item => item.TournamentId == tournament.Id));
        Assert.Equal(3, await verificationDatabase.AuditRecords.CountAsync(item =>
            item.EntityType == "tournament_registration"
            && (item.Action == "tournament.registration.confirmed" || item.Action == "tournament.registration.cancelled_by_user")));

        var blockers = factory!.Services.GetServices<IOrganizationDeleteDependency>();
        var registrationBlocker = Assert.Single(blockers, blocker => blocker.GetType().Name.Contains("Registration", StringComparison.Ordinal));
        Assert.Contains("active_registration", await registrationBlocker.GetBlockersAsync(seed.Organization.Id, CancellationToken.None));
    }

    [Fact]
    public async Task Capability_is_authenticated_server_derived_and_keeps_public_detail_anonymous()
    {
        var tournament = await CreateTournamentAsync("Capability Cup", 2);

        using var anonymous = await Client.GetAsync($"/api/tournaments/{tournament.Id:D}/registration-capability");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        using var available = await SendAsync(HttpMethod.Get, $"/api/tournaments/{tournament.Id:D}/registration-capability", seed.User.Id);
        Assert.Equal(HttpStatusCode.OK, available.StatusCode);
        var availableBody = await available.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(availableBody.GetProperty("canRegister").GetBoolean());
        Assert.False(availableBody.GetProperty("canUnregister").GetBoolean());
        Assert.Equal("available", availableBody.GetProperty("reason").GetString());
        Assert.Equal(0, availableBody.GetProperty("activeParticipantCount").GetInt32());
        Assert.Equal(2, availableBody.GetProperty("capacity").GetInt32());
        Assert.DoesNotContain("public", available.Headers.CacheControl?.ToString() ?? string.Empty, StringComparison.OrdinalIgnoreCase);

        using var unverified = await SendAsync(HttpMethod.Get, $"/api/tournaments/{tournament.Id:D}/registration-capability", seed.Unverified.Id);
        Assert.Equal("email_verification_required", (await unverified.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reason").GetString());
        await using (var database = CreateContext())
        {
            database.OrganizationBlockedUsers.Add(OrganizationBlockedUser.Block(seed.Organization.Id, seed.Blocked.Id, clock.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }
        using var blocked = await SendAsync(HttpMethod.Get, $"/api/tournaments/{tournament.Id:D}/registration-capability", seed.Blocked.Id);
        Assert.Equal("registration_blocked", (await blocked.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reason").GetString());

        using var registered = await RegisterAsync(tournament.Id, seed.User.Id, "capability-register");
        Assert.Equal(HttpStatusCode.Created, registered.StatusCode);
        using var current = await SendAsync(HttpMethod.Get, $"/api/tournaments/{tournament.Id:D}/registration-capability", seed.User.Id);
        var currentBody = await current.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(currentBody.GetProperty("canRegister").GetBoolean());
        Assert.True(currentBody.GetProperty("canUnregister").GetBoolean());
        Assert.Equal("registered", currentBody.GetProperty("reason").GetString());
        Assert.Equal(1, currentBody.GetProperty("activeParticipantCount").GetInt32());

        await using (var database = CreateContext())
        {
            database.TournamentRegistrationAttempts.Add(TournamentRegistrationAttempt.Register(tournament.Id, seed.Registered.Id, seed.Registered.Id, clock.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }
        using var full = await SendAsync(HttpMethod.Get, $"/api/tournaments/{tournament.Id:D}/registration-capability", seed.Organizer.Id);
        Assert.Equal("tournament_full", (await full.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reason").GetString());
        clock.Set(tournament.StartsAtUtc);
        using var started = await SendAsync(HttpMethod.Get, $"/api/tournaments/{tournament.Id:D}/registration-capability", seed.Organizer.Id);
        Assert.Equal("registration_closed", (await started.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reason").GetString());

        using var publicDetail = await Client.GetAsync($"/api/tournaments/{tournament.Slug}");
        var publicJson = await publicDetail.Content.ReadAsStringAsync();
        Assert.DoesNotContain("canRegister", publicJson, StringComparison.Ordinal);
        Assert.DoesNotContain("canUnregister", publicJson, StringComparison.Ordinal);
        Assert.DoesNotContain("reason", publicJson, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Unregister_closes_at_start()
    {
        var tournament = await CreateTournamentAsync("Cutoff Cup", 10);
        using var registered = await RegisterAsync(tournament.Id, seed.User.Id, "cutoff-register");
        Assert.Equal(HttpStatusCode.Created, registered.StatusCode);

        clock.Set(tournament.StartsAtUtc);
        await AssertProblem(await UnregisterAsync(tournament.Id, seed.User.Id, "cutoff-unregister"), HttpStatusCode.Conflict, "unregistration_closed");
    }

    [Fact]
    public async Task Concurrent_users_racing_for_final_slot_create_exactly_one_confirmed_attempt()
    {
        var tournament = await CreateTournamentAsync("Final Slot Cup", 1);
        var racers = await AddUsersAsync(12);
        using var start = new ManualResetEventSlim(false);
        var tasks = racers.Select((user, index) => Task.Run(async () =>
        {
            start.Wait();
            return await RegisterAsync(tournament.Id, user.Id, $"race-{index}");
        })).ToArray();
        start.Set();
        var responses = await Task.WhenAll(tasks);
        try
        {
            Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Created);
            var unexpected = await Task.WhenAll(responses
                .Where(response => response.StatusCode != HttpStatusCode.Created && response.StatusCode != HttpStatusCode.Conflict)
                .Select(async response => $"{response.StatusCode}: {await response.Content.ReadAsStringAsync()}"));
            Assert.True(
                responses.Count(response => response.StatusCode == HttpStatusCode.Conflict) == responses.Length - 1,
                string.Join(Environment.NewLine, unexpected));
        }
        finally
        {
            foreach (var response in responses) response.Dispose();
        }

        await using var database = CreateContext();
        Assert.Equal(1, await database.TournamentRegistrationAttempts.CountAsync(item => item.TournamentId == tournament.Id && item.Status == TournamentRegistrationStatus.Confirmed));
    }

    private async Task EnableOrganizerNoticesAsync()
    {
        await using var database = CreateContext();
        var settings = await database.OrganizationNotificationSettings.SingleAsync(item => item.OrganizationId == seed.Organization.Id);
        settings.Update(true, true, clock.GetCurrentInstant());
        await database.SaveChangesAsync();
    }

    private async Task<ScheduledTournament> CreateTournamentAsync(string title, int capacity)
    {
        await using var database = CreateContext();
        var legacy = await database.TournamentFormats.SingleAsync(item => item.Id == seed.Legacy.Id);
        var tournament = ScheduledTournament.Create(
            seed.Organization.Id,
            seed.Organizer.Id,
            new ScheduledTournamentDraft(title, title.ToLowerInvariant().Replace(' ', '-'), "Summary", null, "12 Street", null, "Paris", "France", "Europe/Paris", new LocalDateTime(2035, 3, 4, 10, 0), new LocalDateTime(2035, 3, 4, 18, 0), capacity),
            [legacy],
            clock.GetCurrentInstant());
        database.ScheduledTournaments.Add(tournament);
        await database.SaveChangesAsync();
        return tournament;
    }

    private async Task<IReadOnlyList<ApplicationUser>> AddUsersAsync(int count)
    {
        await using var database = CreateContext();
        var users = Enumerable.Range(0, count).Select(index => User($"Racer{index}", true)).ToArray();
        database.Users.AddRange(users);
        database.UserProfiles.AddRange(users.Select((user, index) => Profile(user.Id, $"Racer{index}", false)));
        await database.SaveChangesAsync();
        return users;
    }

    private Task<HttpResponseMessage> RegisterAsync(Guid tournamentId, Guid userId, string key) =>
        SendAsync(HttpMethod.Post, $"/api/tournaments/{tournamentId:D}/registrations", userId, key);

    private Task<HttpResponseMessage> UnregisterAsync(Guid tournamentId, Guid userId, string key) =>
        SendAsync(HttpMethod.Delete, $"/api/tournaments/{tournamentId:D}/registrations", userId, key);

    private Task<HttpResponseMessage> SendAsync(HttpMethod method, string url, Guid userId, string? key = null)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Add("X-Test-User", userId.ToString("D"));
        request.Headers.Add("X-Test-Roles", "User");
        if (key is not null) request.Headers.Add("Idempotency-Key", key);
        return Client.SendAsync(request);
    }

    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        using (response)
        {
            Assert.Equal(status, response.StatusCode);
            var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(code, problem.GetProperty("code").GetString());
        }
    }

    private static async Task<SeedRows> SeedAsync(GonesDbContext database)
    {
        var organizer = User("Organizer", true);
        var user = User("CurrentUser", true);
        var registered = User("Registered", true);
        var blocked = User("Blocked", true);
        var unverified = User("Unverified", false);
        var organization = Organization.Create("Registration Org", null, null, null, Now);
        var legacy = await database.TournamentFormats.SingleOrDefaultAsync(item => item.Slug == TournamentFormat.LegacySlug) ?? TournamentFormat.CreateLegacy(Now);
        database.Users.AddRange(organizer, user, registered, blocked, unverified);
        database.UserProfiles.AddRange(
            Profile(organizer.Id, "Organizer", false),
            Profile(user.Id, "CurrentUser", true),
            Profile(registered.Id, "Registered", false),
            Profile(blocked.Id, "Blocked", false),
            Profile(unverified.Id, "Unverified", false));
        database.Organizations.Add(organization);
        if (database.Entry(legacy).State == EntityState.Detached) database.TournamentFormats.Add(legacy);
        await database.SaveChangesAsync();
        database.OrganizationMembers.Add(OrganizationMember.Create(organization.Id, organizer.Id, OrganizationRoles.Owner, Now));
        database.OrganizationNotificationSettings.Add(OrganizationNotificationSettings.CreateDefault(organization.Id, Now));
        await database.SaveChangesAsync();
        return new SeedRows(organization, organizer, user, registered, blocked, unverified, legacy);
    }

    private static ApplicationUser User(string username, bool verified)
    {
        var email = $"{username.ToLowerInvariant()}-{Guid.NewGuid():N}@example.test";
        var user = new ApplicationUser
        {
            Id = Guid.NewGuid(), UserName = email, NormalizedUserName = email.ToUpperInvariant(), Email = email,
            NormalizedEmail = email.ToUpperInvariant(), EmailConfirmed = verified, SecurityStamp = Guid.NewGuid().ToString("N"), ConcurrencyStamp = Guid.NewGuid().ToString("N")
        };
        user.AssignGlobalRole(GlobalRoles.User);
        return user;
    }

    private static UserProfile Profile(Guid userId, string username, bool firstNamePublic)
    {
        var profile = UserProfile.Create(userId, username, "Current", "Private", Now);
        profile.Update(username, "Current", "Private", "Lyon", 1990, "en", firstNamePublic, false, false, false, false, 2030, Now);
        return profile;
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options);
    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");
    private static readonly Instant Now = Instant.FromUtc(2030, 1, 1, 12, 0);

    private sealed record SeedRows(Organization Organization, ApplicationUser Organizer, ApplicationUser User, ApplicationUser Registered, ApplicationUser Blocked, ApplicationUser Unverified, TournamentFormat Legacy);
    private sealed class MutableClock(Instant current) : IClock
    {
        public Instant GetCurrentInstant() => current;
        public void Set(Instant value) => current = value;
    }
}
