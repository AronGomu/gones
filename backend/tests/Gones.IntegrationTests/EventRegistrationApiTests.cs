using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Api.Organizations;
using Gones.Application.Notifications;
using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Identity;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NodaTime;

namespace Gones.IntegrationTests;

public sealed class EventRegistrationApiTests : IAsyncLifetime
{
    private readonly PostgreSqlTestContainer postgres = new();
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
            database.EventRegistrationAttempts.Add(EventRegistrationAttempt.Register(open.Id, seed.Registered.Id, seed.Registered.Id, clock.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }
        await AssertProblem(await RegisterAsync(open.Id, seed.Blocked.Id, "blocked"), HttpStatusCode.Forbidden, "registration_blocked");
        await AssertProblem(await RegisterAsync(open.Id, seed.Registered.Id, "duplicate"), HttpStatusCode.Conflict, "registration_already_active");

        var full = await CreateTournamentAsync("Full Cup", 1);
        await using (var database = CreateContext())
        {
            database.EventRegistrationAttempts.Add(EventRegistrationAttempt.Register(full.Id, seed.Registered.Id, seed.Registered.Id, clock.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }
        await AssertProblem(await RegisterAsync(full.Id, seed.User.Id, "full"), HttpStatusCode.Conflict, "event_full");

        var cancelled = await CreateTournamentAsync("Cancelled Cup", 10);
        cancelled.Cancel(clock.GetCurrentInstant());
        var deleted = await CreateTournamentAsync("Deleted Cup", 10);
        deleted.SoftDelete(seed.Organizer.Id, "hidden", clock.GetCurrentInstant());
        await using (var database = CreateContext())
        {
            database.Events.UpdateRange(cancelled, deleted);
            await database.SaveChangesAsync();
        }
        await AssertProblem(await RegisterAsync(cancelled.Id, seed.User.Id, "cancelled"), HttpStatusCode.Conflict, "event_not_open");
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
            currentProfile.Update(
                "RenamedUser", "Current", "Private",
                "France", "Rhône", "Lyon", new LocalDate(1990, 4, 17),
                "en", true, false, false, false, false,
                clock.GetCurrentInstant().InUtc().Date, clock.GetCurrentInstant());
            await database.SaveChangesAsync();
        }

        using var publicParticipants = await Client.GetAsync($"/api/events/{tournament.Slug}/participants");
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
        var attempts = await verificationDatabase.EventRegistrationAttempts.Where(item => item.UserId == seed.User.Id).OrderBy(item => item.RegisteredAt).ToListAsync();
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

    /// <summary>
    /// ADR 0038 deleted <c>/calendar</c> and <c>/calendar/tournaments/:slug</c> with no redirect, so a
    /// mail still linking there sends the reader to the 404 page. Confirmation, unregistration, major
    /// update and cancellation all mail the same builder, so pinning one pins all four.
    /// </summary>
    [Fact]
    public async Task Registration_mail_links_to_the_live_event_route()
    {
        var tournament = await CreateTournamentAsync("Mail Link Cup", 10);
        using var registered = await RegisterAsync(tournament.Id, seed.User.Id, "register-mail-link");
        Assert.Equal(HttpStatusCode.Created, registered.StatusCode);

        await using var database = CreateContext();
        var mail = await database.NotificationOutboxRecords.AsNoTracking().SingleAsync(item =>
            item.TournamentId == tournament.Id && item.TemplateKey == NotificationTemplateKeys.Registration);
        var rendered = new NotificationTemplateRenderer()
            .Render(mail.Locale, NotificationModelSerializer.Deserialize(mail.TemplateKey, mail.TemplateModelJson!));

        var expected = $"https://app.example/events/{tournament.Slug}";
        Assert.Contains(expected, rendered.TextBody, StringComparison.Ordinal);
        Assert.Contains(expected, rendered.HtmlBody, StringComparison.Ordinal);
        Assert.DoesNotContain("/calendar", rendered.TextBody, StringComparison.Ordinal);
        Assert.DoesNotContain("/calendar", rendered.HtmlBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Public_participant_exposes_year_only()
    {
        var participant = await PublicParticipantAsync("Year Only Cup", birthDatePublic: true, locationPublic: true);

        Assert.Equal(1990, participant.GetProperty("birthYear").GetInt32());
        Assert.Equal("Lyon, Rhône, France", participant.GetProperty("location").GetString());
        Assert.False(participant.TryGetProperty("birthDate", out _));
        Assert.False(participant.TryGetProperty("locationCity", out _));
    }

    [Fact]
    public async Task Public_participant_hides_a_private_birth_date()
    {
        var participant = await PublicParticipantAsync("Private Date Cup", birthDatePublic: false, locationPublic: false);

        Assert.Equal(JsonValueKind.Null, participant.GetProperty("birthYear").ValueKind);
        Assert.Equal(JsonValueKind.Null, participant.GetProperty("location").ValueKind);
    }

    private async Task<JsonElement> PublicParticipantAsync(string title, bool birthDatePublic, bool locationPublic)
    {
        var tournament = await CreateTournamentAsync(title, 4);
        using var registered = await RegisterAsync(tournament.Id, seed.User.Id, $"projection-{Guid.NewGuid():N}");
        Assert.Equal(HttpStatusCode.Created, registered.StatusCode);
        await using (var database = CreateContext())
        {
            var profile = await database.UserProfiles.SingleAsync(item => item.UserId == seed.User.Id);
            profile.Update(
                profile.Username, "Current", "Private",
                "France", "Rhône", "Lyon", new LocalDate(1990, 4, 17),
                "en", false, false, locationPublic, birthDatePublic, false,
                clock.GetCurrentInstant().InUtc().Date, clock.GetCurrentInstant());
            await database.SaveChangesAsync();
        }

        using var response = await Client.GetAsync($"/api/events/{tournament.Slug}/participants");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return Assert.Single(body.GetProperty("items").EnumerateArray()).Clone();
    }

    [Fact]
    public async Task Capability_is_authenticated_server_derived_and_keeps_public_detail_anonymous()
    {
        var tournament = await CreateTournamentAsync("Capability Cup", 2);

        using var anonymous = await Client.GetAsync($"/api/events/{tournament.Id:D}/registration-capability");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        using var available = await SendAsync(HttpMethod.Get, $"/api/events/{tournament.Id:D}/registration-capability", seed.User.Id);
        Assert.Equal(HttpStatusCode.OK, available.StatusCode);
        var availableBody = await available.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(availableBody.GetProperty("canRegister").GetBoolean());
        Assert.False(availableBody.GetProperty("canUnregister").GetBoolean());
        Assert.Equal("available", availableBody.GetProperty("reason").GetString());
        Assert.Equal(0, availableBody.GetProperty("activeParticipantCount").GetInt32());
        Assert.Equal(2, availableBody.GetProperty("capacity").GetInt32());
        Assert.DoesNotContain("public", available.Headers.CacheControl?.ToString() ?? string.Empty, StringComparison.OrdinalIgnoreCase);

        using var unverified = await SendAsync(HttpMethod.Get, $"/api/events/{tournament.Id:D}/registration-capability", seed.Unverified.Id);
        Assert.Equal("email_verification_required", (await unverified.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reason").GetString());
        await using (var database = CreateContext())
        {
            database.OrganizationBlockedUsers.Add(OrganizationBlockedUser.Block(seed.Organization.Id, seed.Blocked.Id, clock.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }
        using var blocked = await SendAsync(HttpMethod.Get, $"/api/events/{tournament.Id:D}/registration-capability", seed.Blocked.Id);
        Assert.Equal("registration_blocked", (await blocked.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reason").GetString());

        using var registered = await RegisterAsync(tournament.Id, seed.User.Id, "capability-register");
        Assert.Equal(HttpStatusCode.Created, registered.StatusCode);
        using var current = await SendAsync(HttpMethod.Get, $"/api/events/{tournament.Id:D}/registration-capability", seed.User.Id);
        var currentBody = await current.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(currentBody.GetProperty("canRegister").GetBoolean());
        Assert.True(currentBody.GetProperty("canUnregister").GetBoolean());
        Assert.Equal("registered", currentBody.GetProperty("reason").GetString());
        Assert.Equal(1, currentBody.GetProperty("activeParticipantCount").GetInt32());

        await using (var database = CreateContext())
        {
            database.EventRegistrationAttempts.Add(EventRegistrationAttempt.Register(tournament.Id, seed.Registered.Id, seed.Registered.Id, clock.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }
        using var full = await SendAsync(HttpMethod.Get, $"/api/events/{tournament.Id:D}/registration-capability", seed.Organizer.Id);
        Assert.Equal("event_full", (await full.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reason").GetString());
        clock.Set(tournament.StartsAtUtc);
        using var started = await SendAsync(HttpMethod.Get, $"/api/events/{tournament.Id:D}/registration-capability", seed.Organizer.Id);
        Assert.Equal("registration_closed", (await started.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("reason").GetString());

        using var publicDetail = await Client.GetAsync($"/api/events/{tournament.Slug}");
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
    public async Task Organizer_routes_hide_cross_org_resources_and_lookup_only_exact_verified_users()
    {
        var tournament = await CreateTournamentAsync("Private Cup", 10);
        using var own = await SendAsync(HttpMethod.Get, $"/api/events/{tournament.Id:D}/registrations", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.OK, own.StatusCode);
        using var outsider = await SendAsync(HttpMethod.Get, $"/api/events/{tournament.Id:D}/registrations", seed.User.Id);
        Assert.Equal(HttpStatusCode.NotFound, outsider.StatusCode);

        await using (var database = CreateContext())
        {
            database.EventRegistrationAttempts.Add(EventRegistrationAttempt.Register(tournament.Id, seed.User.Id, seed.User.Id, clock.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }

        using var exactUsername = await SendAsync(HttpMethod.Get, $"/api/organizations/{seed.Organization.Id:D}/users/lookup?username=CurrentUser", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.OK, exactUsername.StatusCode);
        var lookup = await exactUsername.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(seed.User.Id, lookup.GetProperty("userId").GetGuid());
        Assert.Equal("CurrentUser", lookup.GetProperty("username").GetString());
        Assert.False(lookup.TryGetProperty("email", out _));
        Assert.False(lookup.TryGetProperty("firstName", out _));
        Assert.False(lookup.TryGetProperty("lastName", out _));
        using var exactEmail = await SendAsync(HttpMethod.Get, $"/api/organizations/{seed.Organization.Id:D}/users/lookup?email={Uri.EscapeDataString(seed.User.Email!)}", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.OK, exactEmail.StatusCode);
        Assert.Equal(seed.User.Id, (await exactEmail.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("userId").GetGuid());
        using var partial = await SendAsync(HttpMethod.Get, $"/api/organizations/{seed.Organization.Id:D}/users/lookup?username=Current", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.NotFound, partial.StatusCode);
        // Relate the unverified account to the org first, so its 404 can only come from the missing
        // email confirmation and not from the relatedness filter.
        await using (var database = CreateContext())
        {
            database.EventRegistrationAttempts.Add(EventRegistrationAttempt.Register(tournament.Id, seed.Unverified.Id, seed.Organizer.Id, clock.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }

        using var unverified = await SendAsync(HttpMethod.Get, $"/api/organizations/{seed.Organization.Id:D}/users/lookup?email={Uri.EscapeDataString(seed.Unverified.Email!)}", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.NotFound, unverified.StatusCode);
        using var unauthorizedLookup = await SendAsync(HttpMethod.Get, $"/api/organizations/{seed.Organization.Id:D}/users/lookup?username=CurrentUser", seed.User.Id);
        Assert.Equal(HttpStatusCode.NotFound, unauthorizedLookup.StatusCode);
        using var adminLookup = await SendAsync(HttpMethod.Get, $"/api/organizations/{seed.Organization.Id:D}/users/lookup?username=CurrentUser", seed.Registered.Id, roles: "Admin");
        Assert.Equal(HttpStatusCode.OK, adminLookup.StatusCode);
    }

    /// <summary>
    /// F2. The lookup used to resolve any verified account on the platform and hand back its email
    /// and legal name, so any Organizer could harvest PII across the organization boundary and read
    /// 404-vs-200 as an email-existence oracle. It now answers only for accounts already related to
    /// the organization — a member, or anyone who ever attempted a registration on one of its live
    /// events, whatever that attempt's status — and never with more than userId + username. A
    /// platform Admin bypasses relatedness, never the shrunk body.
    /// </summary>
    [Fact]
    public async Task Lookup_refuses_accounts_unrelated_to_the_organization()
    {
        var live = await CreateTournamentAsync("Relation Cup", 10);
        var deleted = await CreateTournamentAsync("Deleted Relation Cup", 10);
        deleted.SoftDelete(seed.Organizer.Id, "hidden", clock.GetCurrentInstant());
        await using (var database = CreateContext())
        {
            var past = EventRegistrationAttempt.Register(live.Id, seed.Registered.Id, seed.Registered.Id, clock.GetCurrentInstant());
            past.CancelByUser(seed.Registered.Id, clock.GetCurrentInstant());
            database.EventRegistrationAttempts.Add(past);
            database.EventRegistrationAttempts.Add(EventRegistrationAttempt.Register(deleted.Id, seed.Blocked.Id, seed.Blocked.Id, clock.GetCurrentInstant()));
            database.Events.Update(deleted);
            await database.SaveChangesAsync();
        }

        using var unrelated = await LookupAsync("username=CurrentUser", seed.Organizer.Id);
        using var unknown = await LookupAsync("username=Nobody", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.NotFound, unrelated.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal(await ProblemFieldsAsync(unknown), await ProblemFieldsAsync(unrelated));
        using var unrelatedEmail = await LookupAsync($"email={Uri.EscapeDataString(seed.User.Email!)}", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.NotFound, unrelatedEmail.StatusCode);
        using var deletedEventOnly = await LookupAsync("username=Blocked", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.NotFound, deletedEventOnly.StatusCode);

        using var member = await LookupAsync("username=Organizer", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.OK, member.StatusCode);
        var memberBody = await member.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(seed.Organizer.Id, memberBody.GetProperty("userId").GetGuid());
        Assert.Equal("Organizer", memberBody.GetProperty("username").GetString());
        Assert.Equal(
            new[] { "userId", "username" },
            memberBody.EnumerateObject().Select(property => property.Name).OrderBy(name => name, StringComparer.Ordinal).ToArray());

        using var pastParticipant = await LookupAsync("username=Registered", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.OK, pastParticipant.StatusCode);
        Assert.Equal(seed.Registered.Id, (await pastParticipant.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("userId").GetGuid());

        using var adminBypass = await LookupAsync("username=Blocked", seed.User.Id, roles: "Admin");
        Assert.Equal(HttpStatusCode.OK, adminBypass.StatusCode);
        var adminBody = await adminBypass.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(seed.Blocked.Id, adminBody.GetProperty("userId").GetGuid());
        Assert.False(adminBody.TryGetProperty("email", out _));
        Assert.False(adminBody.TryGetProperty("firstName", out _));
        Assert.False(adminBody.TryGetProperty("lastName", out _));
    }

    /// <summary>
    /// The lookup resolves one exact identifier, never a search: naming both criteria, naming neither,
    /// or naming a Username no account could hold is a caller mistake, answered by a 400 that says
    /// which field is wrong rather than by a widened match.
    /// </summary>
    [Fact]
    public async Task Lookup_rejects_a_criterion_that_is_not_one_exact_identifier()
    {
        using var both = await LookupAsync($"username=CurrentUser&email={Uri.EscapeDataString(seed.User.Email!)}", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.BadRequest, both.StatusCode);
        Assert.Equal("lookup", InvalidFieldOf(await both.Content.ReadFromJsonAsync<JsonElement>()));

        using var neither = await LookupAsync("username=%20", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.BadRequest, neither.StatusCode);
        Assert.Equal("lookup", InvalidFieldOf(await neither.Content.ReadFromJsonAsync<JsonElement>()));

        using var tooShort = await LookupAsync("username=ab", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.BadRequest, tooShort.StatusCode);
        Assert.Equal("username", InvalidFieldOf(await tooShort.Content.ReadFromJsonAsync<JsonElement>()));
    }

    /// <summary>
    /// Membership relates an account to one organization, not to the platform: the same subject that
    /// a rival organization resolves as its own member stays unknown to ours.
    /// </summary>
    [Fact]
    public async Task Lookup_refuses_a_member_of_another_organization()
    {
        var rival = await CreateOrganizationAsync("Rival Org", seed.User.Id, seed.Registered.Id);

        using var ours = await LookupAsync("username=CurrentUser", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.NotFound, ours.StatusCode);

        using var theirs = await SendAsync(HttpMethod.Get, $"/api/organizations/{rival.Id:D}/users/lookup?username=CurrentUser", seed.Registered.Id);
        Assert.Equal(HttpStatusCode.OK, theirs.StatusCode);
        Assert.Equal(seed.User.Id, (await theirs.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("userId").GetGuid());
    }

    /// <summary>
    /// A registration attempt relates its subject to the organization that owns the event, and to no
    /// other: registering on a rival's tournament must not make an account resolvable through ours.
    /// </summary>
    [Fact]
    public async Task Lookup_refuses_a_registrant_of_another_organizations_event()
    {
        var rival = await CreateOrganizationAsync("Rival Org", seed.Registered.Id);
        var rivalTournament = await CreateTournamentAsync(rival.Id, "Rival Cup", 10);
        await using (var database = CreateContext())
        {
            database.EventRegistrationAttempts.Add(EventRegistrationAttempt.Register(rivalTournament.Id, seed.User.Id, seed.User.Id, clock.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }

        using var ours = await LookupAsync("username=CurrentUser", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.NotFound, ours.StatusCode);

        using var theirs = await SendAsync(HttpMethod.Get, $"/api/organizations/{rival.Id:D}/users/lookup?username=CurrentUser", seed.Registered.Id);
        Assert.Equal(HttpStatusCode.OK, theirs.StatusCode);
        Assert.Equal(seed.User.Id, (await theirs.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("userId").GetGuid());
    }

    /// <summary>
    /// Closing an account withdraws it from the lookup even where the relation that made it visible
    /// survives: the organizer keeps the past registration, not a handle on the person who left.
    /// The email is the only key that outlives closure, so it is the one this asserts on.
    /// </summary>
    [Fact]
    public async Task Lookup_refuses_a_closed_account_that_is_still_related_to_the_organization()
    {
        var tournament = await CreateTournamentAsync("Closure Cup", 10);
        await using (var database = CreateContext())
        {
            database.EventRegistrationAttempts.Add(EventRegistrationAttempt.Register(tournament.Id, seed.Registered.Id, seed.Registered.Id, clock.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }

        var byEmail = $"email={Uri.EscapeDataString(seed.Registered.Email!)}";
        using var whileOpen = await LookupAsync(byEmail, seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.OK, whileOpen.StatusCode);

        await using (var database = CreateContext())
        {
            var profile = await database.UserProfiles.SingleAsync(item => item.UserId == seed.Registered.Id);
            profile.CloseAndAnonymize("deleted-account", clock.GetCurrentInstant());
            await database.SaveChangesAsync();
        }

        using var whenClosed = await LookupAsync(byEmail, seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.NotFound, whenClosed.StatusCode);
    }

    /// <summary>
    /// The email criterion must not become the existence oracle the username criterion is not: an
    /// unrelated address that does have an account answers byte for byte like one that has none.
    /// </summary>
    [Fact]
    public async Task Lookup_answers_an_unrelated_email_exactly_like_an_unknown_email()
    {
        using var unrelated = await LookupAsync($"email={Uri.EscapeDataString(seed.User.Email!)}", seed.Organizer.Id);
        using var unknown = await LookupAsync($"email={Uri.EscapeDataString($"nobody-{Guid.NewGuid():N}@example.test")}", seed.Organizer.Id);

        Assert.Equal(HttpStatusCode.NotFound, unrelated.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal(await ProblemFieldsAsync(unknown), await ProblemFieldsAsync(unrelated));
    }

    /// <summary>
    /// Relatedness is the existence of an attempt, never its outcome: an organizer who cancelled a
    /// tournament or removed a participant can still find them to add them back. An account that
    /// never attempted anything stays unknown, so the 200s below are not a blanket answer.
    /// </summary>
    [Fact]
    public async Task Lookup_resolves_past_participants_whatever_ended_their_attempt()
    {
        var tournament = await CreateTournamentAsync("Aftermath Cup", 10);
        await using (var database = CreateContext())
        {
            var cancelledByTournament = EventRegistrationAttempt.Register(tournament.Id, seed.User.Id, seed.User.Id, clock.GetCurrentInstant());
            cancelledByTournament.CancelByTournament(seed.Organizer.Id, clock.GetCurrentInstant());
            var removedByOrganizer = EventRegistrationAttempt.Register(tournament.Id, seed.Registered.Id, seed.Registered.Id, clock.GetCurrentInstant());
            removedByOrganizer.RemoveByOrganizer(seed.Organizer.Id, clock.GetCurrentInstant());
            database.EventRegistrationAttempts.AddRange(cancelledByTournament, removedByOrganizer);
            await database.SaveChangesAsync();
        }

        using var cancelled = await LookupAsync("username=CurrentUser", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.OK, cancelled.StatusCode);
        Assert.Equal(seed.User.Id, (await cancelled.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("userId").GetGuid());

        using var removed = await LookupAsync("username=Registered", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.OK, removed.StatusCode);
        Assert.Equal(seed.Registered.Id, (await removed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("userId").GetGuid());

        using var neverAttempted = await LookupAsync("username=Blocked", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.NotFound, neverAttempted.StatusCode);
    }

    /// <summary>
    /// The lookup is an unauthenticated-username-to-account probe for anyone holding one organizer
    /// seat, so it is throttled like a registration write. The Testing environment relaxes every
    /// limit to a million permits, so the mapping is asserted on the route metadata, not by
    /// exhausting a window.
    /// </summary>
    [Fact]
    public void Lookup_route_is_mapped_under_the_registration_rate_limit_policy()
    {
        var lookup = Factory.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .Single(endpoint => endpoint.RoutePattern.RawText == "/api/organizations/{organizationId:guid}/users/lookup");

        Assert.Equal(
            new[] { "registration-user" },
            lookup.Metadata.GetOrderedMetadata<EnableRateLimitingAttribute>().Select(policy => policy.PolicyName).ToArray());
    }

    [Fact]
    public async Task Block_expiry_unblock_and_list_preserve_existing_registration()
    {
        var tournament = await CreateTournamentAsync("Block Cup", 10);
        await using (var database = CreateContext())
        {
            database.EventRegistrationAttempts.Add(EventRegistrationAttempt.Register(tournament.Id, seed.User.Id, seed.User.Id, clock.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }

        using var blocked = await SendJsonAsync(HttpMethod.Post, $"/api/organizations/{seed.Organization.Id:D}/blocked-users", seed.Organizer.Id, new
        {
            userId = seed.User.Id,
            reason = "Repeated no-show",
            expiresAt = (clock.GetCurrentInstant() + Duration.FromHours(1)).ToString()
        });
        Assert.Equal(HttpStatusCode.Created, blocked.StatusCode);
        using var list = await SendAsync(HttpMethod.Get, $"/api/organizations/{seed.Organization.Id:D}/blocked-users", seed.Organizer.Id);
        var listBody = await list.Content.ReadFromJsonAsync<JsonElement>();
        var item = Assert.Single(listBody.GetProperty("items").EnumerateArray());
        Assert.Equal("Repeated no-show", item.GetProperty("reason").GetString());
        Assert.Equal(seed.Organizer.Id, item.GetProperty("blockedByUserId").GetGuid());

        await using (var database = CreateContext())
        {
            Assert.Equal(TournamentRegistrationStatus.Confirmed, (await database.EventRegistrationAttempts.SingleAsync()).Status);
        }

        clock.Set(clock.GetCurrentInstant() + Duration.FromHours(2));
        using var reblocked = await SendJsonAsync(HttpMethod.Post, $"/api/organizations/{seed.Organization.Id:D}/blocked-users", seed.Organizer.Id, new
        {
            userId = seed.User.Id,
            reason = "New active block",
            expiresAt = (Instant?)null
        });
        Assert.Equal(HttpStatusCode.Created, reblocked.StatusCode);
        using var unblocked = await SendAsync(HttpMethod.Delete, $"/api/organizations/{seed.Organization.Id:D}/blocked-users/{seed.User.Id:D}", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.NoContent, unblocked.StatusCode);
        using var emptyList = await SendAsync(HttpMethod.Get, $"/api/organizations/{seed.Organization.Id:D}/blocked-users", seed.Organizer.Id);
        Assert.Equal(0, (await emptyList.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task Organizer_manual_registration_and_removal_record_actor_deadline_mail_and_private_projection()
    {
        var tournament = await CreateTournamentAsync("Managed Cup", 10);
        using var added = await SendJsonAsync(HttpMethod.Post, $"/api/events/{tournament.Id:D}/registrations/by-organizer", seed.Organizer.Id, new { userId = seed.User.Id });
        Assert.Equal(HttpStatusCode.Created, added.StatusCode);
        var addedBody = await added.Content.ReadFromJsonAsync<JsonElement>();
        var registrationId = addedBody.GetProperty("attemptId").GetGuid();
        await AssertProblem(
            await SendJsonAsync(HttpMethod.Post, $"/api/events/{tournament.Id:D}/registrations/by-organizer", seed.Organizer.Id, new { userId = seed.User.Id }),
            HttpStatusCode.Conflict,
            "registration_already_active");
        await AssertProblem(
            await SendJsonAsync(HttpMethod.Post, $"/api/events/{tournament.Id:D}/registrations/by-organizer", seed.Organizer.Id, new { userId = seed.Unverified.Id }),
            HttpStatusCode.Forbidden,
            "email_verification_required");
        await using (var database = CreateContext())
        {
            database.OrganizationBlockedUsers.Add(OrganizationBlockedUser.Block(
                seed.Organization.Id,
                seed.Blocked.Id,
                "Blocked by Organizer",
                seed.Organizer.Id,
                clock.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }
        await AssertProblem(
            await SendJsonAsync(HttpMethod.Post, $"/api/events/{tournament.Id:D}/registrations/by-organizer", seed.Organizer.Id, new { userId = seed.Blocked.Id }),
            HttpStatusCode.Forbidden,
            "registration_blocked");

        using var privateList = await SendAsync(HttpMethod.Get, $"/api/events/{tournament.Id:D}/registrations", seed.Organizer.Id);
        var privateBody = await privateList.Content.ReadFromJsonAsync<JsonElement>();
        var participant = Assert.Single(privateBody.GetProperty("items").EnumerateArray());
        Assert.Equal(seed.User.Email, participant.GetProperty("email").GetString());
        Assert.Equal("Current", participant.GetProperty("firstName").GetString());
        Assert.Equal(seed.Organizer.Id, participant.GetProperty("registeredByUserId").GetGuid());

        using var publicList = await Client.GetAsync($"/api/events/{tournament.Slug}/participants");
        var publicJson = await publicList.Content.ReadAsStringAsync();
        Assert.DoesNotContain(seed.User.Email!, publicJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("registeredAt", publicJson, StringComparison.Ordinal);

        using var removed = await SendAsync(HttpMethod.Delete, $"/api/events/{tournament.Id:D}/registrations/{registrationId:D}", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.OK, removed.StatusCode);
        await using (var database = CreateContext())
        {
            var attempt = await database.EventRegistrationAttempts.SingleAsync(item => item.Id == registrationId);
            Assert.Equal(TournamentRegistrationStatus.RemovedByOrganizer, attempt.Status);
            Assert.Equal(seed.Organizer.Id, attempt.RegisteredByUserId);
            Assert.Equal(seed.Organizer.Id, attempt.StatusChangedByUserId);
            Assert.Equal(2, await database.NotificationOutboxRecords.CountAsync(item => item.TournamentId == tournament.Id));
        }

        using var addedAgain = await SendJsonAsync(HttpMethod.Post, $"/api/events/{tournament.Id:D}/registrations/by-organizer", seed.Organizer.Id, new { userId = seed.Registered.Id });
        Assert.Equal(HttpStatusCode.Created, addedAgain.StatusCode);
        var secondId = (await addedAgain.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("attemptId").GetGuid();
        clock.Set(tournament.StartsAtUtc);
        await AssertProblem(await SendAsync(HttpMethod.Delete, $"/api/events/{tournament.Id:D}/registrations/{secondId:D}", seed.Organizer.Id), HttpStatusCode.Conflict, "unregistration_closed");
    }

    [Fact]
    public async Task Organizer_csv_is_streamed_fixed_bounded_formula_safe_and_audited_without_pii()
    {
        var tournament = await CreateTournamentAsync("CSV Cup", 10);
        await using (var database = CreateContext())
        {
            var profile = await database.UserProfiles.SingleAsync(item => item.UserId == seed.User.Id);
            profile.Update(
                "CurrentUser", "=HYPERLINK(\"https://bad.test\")", "Comma,\"Quote\"",
                "France", "Rhône", "Lyon", new LocalDate(1990, 4, 17),
                "en", false, false, false, false, false,
                clock.GetCurrentInstant().InUtc().Date, clock.GetCurrentInstant());
            database.EventRegistrationAttempts.Add(EventRegistrationAttempt.Register(tournament.Id, seed.User.Id, seed.Organizer.Id, clock.GetCurrentInstant()));
            await database.SaveChangesAsync();
        }

        using var export = await SendAsync(HttpMethod.Get, $"/api/events/{tournament.Id:D}/registrations/export", seed.Organizer.Id);
        Assert.Equal(HttpStatusCode.OK, export.StatusCode);
        Assert.Equal("text/csv", export.Content.Headers.ContentType?.MediaType);
        Assert.Contains("attachment", export.Content.Headers.ContentDisposition?.ToString(), StringComparison.OrdinalIgnoreCase);
        var csv = await export.Content.ReadAsStringAsync();
        Assert.StartsWith("Username,FirstName,LastName,Email,RegisteredAt\r\n", csv, StringComparison.Ordinal);
        Assert.Contains("\"'=HYPERLINK(\"\"https://bad.test\"\")\"", csv, StringComparison.Ordinal);
        Assert.Contains("\"Comma,\"\"Quote\"\"\"", csv, StringComparison.Ordinal);

        await using var verificationDatabase = CreateContext();
        var audit = await verificationDatabase.AuditRecords.SingleAsync(item => item.Action == "tournament.participants.exported");
        Assert.Contains("rowCount", audit.RedactedDiff, StringComparison.Ordinal);
        Assert.Contains("columns", audit.RedactedDiff, StringComparison.Ordinal);
        Assert.DoesNotContain(seed.User.Email!, audit.RedactedDiff, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("CurrentUser", audit.RedactedDiff, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Concurrent_organizer_manual_adds_for_final_slot_create_exactly_one_confirmed_attempt()
    {
        var tournament = await CreateTournamentAsync("Managed Final Slot", 1);
        var racers = await AddUsersAsync(8);
        using var start = new ManualResetEventSlim(false);
        var tasks = racers.Select(user => Task.Run(async () =>
        {
            start.Wait();
            return await SendJsonAsync(HttpMethod.Post, $"/api/events/{tournament.Id:D}/registrations/by-organizer", seed.Organizer.Id, new { userId = user.Id });
        })).ToArray();
        start.Set();
        var responses = await Task.WhenAll(tasks);
        try
        {
            Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Created);
            Assert.Equal(responses.Length - 1, responses.Count(response => response.StatusCode == HttpStatusCode.Conflict));
        }
        finally
        {
            foreach (var response in responses) response.Dispose();
        }
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
        Assert.Equal(1, await database.EventRegistrationAttempts.CountAsync(item => item.EventId == tournament.Id && item.Status == TournamentRegistrationStatus.Confirmed));
    }

    private async Task EnableOrganizerNoticesAsync()
    {
        await using var database = CreateContext();
        var settings = await database.OrganizationNotificationSettings.SingleAsync(item => item.OrganizationId == seed.Organization.Id);
        settings.Update(true, true, clock.GetCurrentInstant());
        await database.SaveChangesAsync();
    }

    private Task<Event> CreateTournamentAsync(string title, int capacity) =>
        CreateTournamentAsync(seed.Organization.Id, title, capacity);

    private async Task<Event> CreateTournamentAsync(Guid organizationId, string title, int capacity)
    {
        await using var database = CreateContext();
        var legacy = await database.TournamentFormats.SingleAsync(item => item.Id == seed.Legacy.Id);
        var tournament = Event.Create(
            organizationId,
            seed.Organizer.Id,
            new ScheduledTournamentDraft(title, title.ToLowerInvariant().Replace(' ', '-'), "Summary", null, "12 Street", null, "Paris", "France", "Europe/Paris", new LocalDateTime(2035, 3, 4, 10, 0), new LocalDateTime(2035, 3, 4, 18, 0), capacity),
            [legacy],
            clock.GetCurrentInstant());
        database.Events.Add(tournament);
        await database.SaveChangesAsync();
        return tournament;
    }

    /// <summary>A second organization, with the given accounts as its organizers.</summary>
    private async Task<Organization> CreateOrganizationAsync(string name, params Guid[] memberUserIds)
    {
        await using var database = CreateContext();
        var organization = Organization.Create(name, null, null, null, clock.GetCurrentInstant());
        database.Organizations.Add(organization);
        await database.SaveChangesAsync();
        database.OrganizationMembers.AddRange(memberUserIds.Select(userId =>
            OrganizationMember.Create(organization.Id, userId, OrganizationRoles.Organizer, clock.GetCurrentInstant())));
        await database.SaveChangesAsync();
        return organization;
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
        SendAsync(HttpMethod.Post, $"/api/events/{tournamentId:D}/registrations", userId, key);

    private Task<HttpResponseMessage> UnregisterAsync(Guid tournamentId, Guid userId, string key) =>
        SendAsync(HttpMethod.Delete, $"/api/events/{tournamentId:D}/registrations", userId, key);

    private Task<HttpResponseMessage> SendAsync(HttpMethod method, string url, Guid userId, string? key = null, string roles = "User")
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Add("X-Test-User", userId.ToString("D"));
        request.Headers.Add("X-Test-Roles", roles);
        if (key is not null) request.Headers.Add("Idempotency-Key", key);
        return Client.SendAsync(request);
    }

    private Task<HttpResponseMessage> SendJsonAsync(HttpMethod method, string url, Guid userId, object body, string roles = "User")
    {
        var request = new HttpRequestMessage(method, url)
        {
            Content = JsonContent.Create(body)
        };
        request.Headers.Add("X-Test-User", userId.ToString("D"));
        request.Headers.Add("X-Test-Roles", roles);
        return Client.SendAsync(request);
    }

    private Task<HttpResponseMessage> LookupAsync(string query, Guid callerId, string roles = "User") =>
        SendAsync(HttpMethod.Get, $"/api/organizations/{seed.Organization.Id:D}/users/lookup?{query}", callerId, roles: roles);

    /// <summary>The single field a validation problem blames.</summary>
    private static string InvalidFieldOf(JsonElement problem) =>
        problem.GetProperty("errors").EnumerateObject().Single().Name;

    /// <summary>Problem body minus the per-request traceId, so two 404s can be compared for an oracle.</summary>
    private static async Task<string> ProblemFieldsAsync(HttpResponseMessage response)
    {
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        return string.Join('|', problem.EnumerateObject()
            .Where(property => property.Name != "traceId")
            .OrderBy(property => property.Name, StringComparer.Ordinal)
            .Select(property => $"{property.Name}={property.Value}"));
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
        database.OrganizationMembers.Add(OrganizationMember.Create(organization.Id, organizer.Id, OrganizationRoles.Organizer, Now));
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
        profile.Update(
            username, "Current", "Private",
            "France", "Rhône", "Lyon", new LocalDate(1990, 4, 17),
            "en", firstNamePublic, false, false, false, false,
            Now.InUtc().Date, Now);
        return profile;
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>().ConfigureGones(postgres.GetConnectionString()).Options);
    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");
    private WebApplicationFactory<Program> Factory => factory ?? throw new InvalidOperationException("Factory not initialized.");
    private static readonly Instant Now = Instant.FromUtc(2030, 1, 1, 12, 0);

    private sealed record SeedRows(Organization Organization, ApplicationUser Organizer, ApplicationUser User, ApplicationUser Registered, ApplicationUser Blocked, ApplicationUser Unverified, TournamentFormat Legacy);
    private sealed class MutableClock(Instant current) : IClock
    {
        public Instant GetCurrentInstant() => current;
        public void Set(Instant value) => current = value;
    }
}
