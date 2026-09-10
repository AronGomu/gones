using System.Data.Common;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Domain.Identity;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Gones.IntegrationTests;

public sealed partial class OwnerSetupTests
{
    [Theory]
    [InlineData("local")]
    [InlineData("callback")]
    [InlineData("complete")]
    [InlineData("verify-email")]
    public async Task Setup_freshness_lock_serializes_every_ordinary_establishment(string entry)
    {
        await using var db = Db();
        Assert.True((await IssueAsync(db)).Enqueued);
        var token = await TokenAsync();
        var gate = new EnrollmentGate();
        await using var setupFactory = InterceptedFactory(new PauseSetupInsert(gate));
        using var setupHttp = setupFactory.CreateClient();
        await using var ordinaryFactory = OAuthFactory();
        using var ordinaryHttp = ordinaryFactory.CreateClient(new() { AllowAutoRedirect = false, HandleCookies = false });
        using var establishment = await EstablishmentRequestAsync(ordinaryHttp, entry);
        var setupTask = setupHttp.PostAsJsonAsync("/api/auth/owner-setup", Request(token));
        Task<HttpResponseMessage>? ordinaryTask = null;
        var blocked = false;
        try
        {
            var holder = await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(15));
            ordinaryTask = ordinaryHttp.SendAsync(establishment);
            blocked = await EnrollmentWaitAsync(holder, ordinaryTask);
            if (!blocked)
            {
                using var ordinary = await ordinaryTask;
                Assert.Equal(entry == "local" ? HttpStatusCode.Accepted : HttpStatusCode.OK, ordinary.StatusCode);
                // On the unsafe implementation, establish, verify and hard-delete before setup resumes.
                await VerifyAndDeleteOrdinaryAsync(ordinaryHttp);
                Assert.Empty(await db.Users.AsNoTracking().ToListAsync());
                Assert.True(await db.AuditRecords.AnyAsync(record => record.Action == "account.deleted"));
            }
        }
        finally { gate.Release.TrySetResult(); }
        using var setup = await setupTask.WaitAsync(TimeSpan.FromSeconds(15));
        Assert.Equal(HttpStatusCode.NoContent, setup.StatusCode);
        using var completedOrdinary = await ordinaryTask!.WaitAsync(TimeSpan.FromSeconds(15));
        var enrolled = await db.Users.AsNoTracking().SingleAsync();
        Assert.Equal((await db.OwnerSetups.AsNoTracking().SingleAsync()).UserId, enrolled.Id);
        Assert.True(blocked, "Ordinary establishment committed and was hard-deleted during setup freshness authorization; setup recreated the owner.");
        Assert.Equal(entry == "local" ? HttpStatusCode.Accepted : HttpStatusCode.Conflict, completedOrdinary.StatusCode);
        Assert.False(await db.AuditRecords.AnyAsync(record => record.Action == "auth.register.succeeded" || record.Action == "auth.external_identity.registered"));
    }

    [Theory]
    [InlineData("local")]
    [InlineData("callback")]
    [InlineData("complete")]
    [InlineData("verify-email")]
    public async Task Ordinary_establishment_commit_blocks_setup_then_deleted_history_disables_after_restart(string entry)
    {
        await using var db = Db();
        Assert.True((await IssueAsync(db)).Enqueued);
        var token = await TokenAsync();
        var before = await db.OwnerSetups.AsNoTracking().SingleAsync();
        var commitGate = new EnrollmentGate();
        var freshnessGate = new EnrollmentGate();
        await using var ordinaryFactory = OAuthFactory(new PauseEstablishmentCommit(commitGate));
        using var ordinaryHttp = ordinaryFactory.CreateClient(new() { AllowAutoRedirect = false, HandleCookies = false });
        using var establishment = await EstablishmentRequestAsync(ordinaryHttp, entry);
        await using var setupFactory = InterceptedFactory(new PauseFreshnessRead(freshnessGate));
        using var setupHttp = setupFactory.CreateClient();
        var ordinaryTask = ordinaryHttp.SendAsync(establishment);
        Task<HttpResponseMessage>? setupTask = null;
        var blocked = false;
        try
        {
            var holder = await commitGate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(15));
            // The interceptor verified all three writes on the writer connection before publishing its PID.
            Assert.Empty(await db.Users.AsNoTracking().ToListAsync());
            setupTask = setupHttp.PostAsJsonAsync("/api/auth/owner-setup", Request(token));
            blocked = await EnrollmentWaitAsync(holder, setupTask);
            commitGate.Release.TrySetResult();
            using var ordinary = await ordinaryTask.WaitAsync(TimeSpan.FromSeconds(15));
            Assert.Equal(entry == "local" ? HttpStatusCode.Accepted : HttpStatusCode.OK, ordinary.StatusCode);
            await freshnessGate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(15));
            // Setup now owns enrollment, but has not queried history. Deletion need not join this lock.
            await VerifyAndDeleteOrdinaryAsync(ordinaryHttp);
            Assert.Empty(await db.Users.AsNoTracking().ToListAsync());
        }
        finally
        {
            commitGate.Release.TrySetResult();
            freshnessGate.Release.TrySetResult();
        }
        using var setup = await setupTask!.WaitAsync(TimeSpan.FromSeconds(15));
        Assert.Equal(HttpStatusCode.BadRequest, setup.StatusCode);
        Assert.True(blocked, "Setup did not wait on enrollment while ordinary user/profile/establishment audit were saved but uncommitted.");
        db.ChangeTracker.Clear();
        var disabled = await db.OwnerSetups.SingleAsync();
        Assert.False(disabled.Enabled);
        Assert.Null(disabled.CompletedAt);
        Assert.True(before.TokenHash == disabled.TokenHash);
        Assert.Equal(before.IssuedAt, disabled.IssuedAt);
        Assert.True(await db.AuditRecords.AnyAsync(record => record.ActorId == null &&
            (record.Action == "auth.register.succeeded" || record.Action == "auth.external_identity.registered")));
        var mailCount = await db.NotificationOutboxRecords.CountAsync();
        await using var restarted = Factory();
        using var restartedHttp = restarted.CreateClient();
        using var retry = await restartedHttp.PostAsJsonAsync("/api/auth/owner-setup", Request(token));
        Assert.Equal(HttpStatusCode.BadRequest, retry.StatusCode);
        foreach (var command in new[] { "setup", "resend", "promote" })
            Assert.NotEqual(0, (await CliAsync("owner", command)).ExitCode);
        Assert.Empty(await db.Users.AsNoTracking().ToListAsync());
        Assert.Equal(mailCount, await db.NotificationOutboxRecords.CountAsync());
        Assert.False(await db.SystemMarkers.AnyAsync(marker => marker.ConsumedAt != null));
        var after = await db.OwnerSetups.AsNoTracking().SingleAsync();
        Assert.False(after.Enabled);
        Assert.Null(after.CompletedAt);
        Assert.True(before.TokenHash == after.TokenHash);
        Assert.Equal(before.IssuedAt, after.IssuedAt);
    }

    private WebApplicationFactory<Program> InterceptedFactory(params IInterceptor[] interceptors) =>
        Factory().WithWebHostBuilder(builder => builder.ConfigureServices(services =>
            services.AddDbContext<GonesDbContext>(options => options.AddInterceptors(interceptors))));

    private WebApplicationFactory<Program> OAuthFactory(params IInterceptor[] interceptors) =>
        InterceptedFactory(interceptors).WithWebHostBuilder(builder =>
        {
            builder.UseSetting("GONES_AUTH_PROVIDER", "Fake");
            builder.UseSetting("GONES_OAUTH_CALLBACK_ORIGIN", "https://oauth.example");
        });

    private async Task<HttpRequestMessage> EstablishmentRequestAsync(HttpClient http, string entry)
    {
        if (entry == "local") return new(HttpMethod.Post, "/api/auth/register")
        {
            Content = JsonContent.Create(new { email = Owner, username = "OrdinaryOwner", password = Password, firstName = "Fixture", lastName = "Owner" })
        };
        using var startRequest = new HttpRequestMessage(HttpMethod.Get, "/api/auth/oauth/google/start");
        startRequest.Headers.Add("X-Gones-Fake-OAuth-Scenario", entry == "callback" ? "complete" : entry == "complete" ? "incomplete" : "unverified_email");
        startRequest.Headers.Add("X-Gones-Fake-OAuth-Subject", "s6-enrollment-fixture");
        startRequest.Headers.Add("X-Gones-Fake-OAuth-Email", Owner);
        using var start = await http.SendAsync(startRequest);
        Assert.Equal(HttpStatusCode.Redirect, start.StatusCode);
        var cookie = start.Headers.GetValues("Set-Cookie").Single().Split(';')[0];
        using var authorize = await http.GetAsync(start.Headers.Location!.PathAndQuery);
        Assert.Equal(HttpStatusCode.Redirect, authorize.StatusCode);
        var callbackRequest = new HttpRequestMessage(HttpMethod.Get, authorize.Headers.Location!.PathAndQuery);
        callbackRequest.Headers.Add("Cookie", cookie);
        if (entry == "callback") return callbackRequest;
        using var callback = await http.SendAsync(callbackRequest);
        callbackRequest.Dispose();
        Assert.Equal(HttpStatusCode.OK, callback.StatusCode);
        var body = await callback.Content.ReadFromJsonAsync<JsonElement>();
        var completion = new HttpRequestMessage(HttpMethod.Post, "/api/auth/oauth/complete")
        {
            Content = JsonContent.Create(new { completionTicket = body.GetProperty("completionTicket").GetString(), email = Owner,
                username = "OrdinaryOwner", firstName = "Fixture", lastName = "Owner" })
        };
        if (entry == "complete") return completion;
        using var pending = await http.SendAsync(completion);
        completion.Dispose();
        Assert.Equal(HttpStatusCode.Accepted, pending.StatusCode);
        return new(HttpMethod.Post, "/api/auth/oauth/verify-email")
        {
            Content = JsonContent.Create(new { token = await OrdinaryTokenAsync("verify-email") })
        };
    }

    private async Task<string> OrdinaryTokenAsync(string template)
    {
        await using var db = Db();
        var model = await db.NotificationOutboxRecords.Where(record => record.TemplateKey == template)
            .OrderByDescending(record => record.CreatedAt).Select(record => record.TemplateModelJson).FirstAsync();
        using var json = JsonDocument.Parse(model!);
        return System.Web.HttpUtility.ParseQueryString(new Uri(json.RootElement.GetProperty("actionUrl").GetString()!).Query)["token"]!;
    }

    private async Task VerifyAndDeleteOrdinaryAsync(HttpClient http)
    {
        await using var db = Db();
        var user = await db.Users.AsNoTracking().SingleAsync();
        if (!user.EmailConfirmed)
        {
            using var verified = await http.PostAsJsonAsync("/api/auth/verify-email", new { token = await OrdinaryTokenAsync("verify-email") });
            Assert.Equal(HttpStatusCode.NoContent, verified.StatusCode);
        }
        if (user.PasswordHash is null)
        {
            using var forgot = await http.PostAsJsonAsync("/api/auth/forgot-password", new { email = Owner });
            Assert.Equal(HttpStatusCode.Accepted, forgot.StatusCode);
            using var reset = await http.PostAsJsonAsync("/api/auth/reset-password", new { token = await OrdinaryTokenAsync("reset-password"), password = Password });
            Assert.Equal(HttpStatusCode.NoContent, reset.StatusCode);
        }
        using var login = await http.PostAsJsonAsync("/api/auth/login", new { email = Owner, password = Password });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var body = await login.Content.ReadFromJsonAsync<JsonElement>();
        using var deletion = new HttpRequestMessage(HttpMethod.Delete, "/api/users/me") { Content = JsonContent.Create(new { currentPassword = Password }) };
        deletion.Headers.Authorization = new AuthenticationHeaderValue("Bearer", body.GetProperty("accessToken").GetString());
        using var deleted = await http.SendAsync(deletion);
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
    }

    private async Task<bool> EnrollmentWaitAsync(int holder, Task request)
    {
        await using var observer = new NpgsqlConnection(postgres.GetConnectionString());
        await observer.OpenAsync();
        var timer = Stopwatch.StartNew();
        while (timer.Elapsed < TimeSpan.FromSeconds(10))
        {
            await using var command = new NpgsqlCommand("""
                SELECT EXISTS (SELECT 1 FROM pg_stat_activity
                WHERE datname = current_database() AND pid <> @holder AND wait_event_type = 'Lock'
                  AND query LIKE '%owner_setups%' AND query LIKE '%FOR UPDATE%'
                  AND @holder = ANY(pg_blocking_pids(pid)))
                """, observer);
            command.Parameters.AddWithValue("holder", holder);
            if ((bool)(await command.ExecuteScalarAsync())!) return true;
            if (request.IsCompleted) return false;
            await Task.Delay(20);
        }
        return false;
    }

    private sealed class EnrollmentGate
    {
        public TaskCompletionSource<int> Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task PauseAsync(DbConnection connection)
        {
            Entered.TrySetResult(((NpgsqlConnection)connection).ProcessID);
            await Release.Task.WaitAsync(TimeSpan.FromSeconds(45));
        }
    }

    private sealed class PauseSetupInsert(EnrollmentGate gate) : SaveChangesInterceptor
    {
        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (eventData.Context!.ChangeTracker.Entries<ApplicationUser>().Any(entry => entry.State == EntityState.Added))
                await gate.PauseAsync(eventData.Context.Database.GetDbConnection());
            return result;
        }
    }

    private sealed class PauseFreshnessRead(EnrollmentGate gate) : DbCommandInterceptor
    {
        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("SELECT EXISTS", StringComparison.Ordinal) && command.CommandText.Contains("asp_net_users", StringComparison.Ordinal))
                await gate.PauseAsync(command.Connection!);
            return result;
        }
    }

    private sealed class PauseEstablishmentCommit(EnrollmentGate gate) : DbTransactionInterceptor
    {
        public override async ValueTask<InterceptionResult> TransactionCommittingAsync(DbTransaction transaction,
            TransactionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default)
        {
            if (!eventData.Context!.ChangeTracker.Entries<AuditRecord>().Any(entry =>
                entry.Entity.Action is "auth.register.succeeded" or "auth.external_identity.registered")) return result;
            await using var command = transaction.Connection!.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                SELECT (SELECT count(*) FROM asp_net_users) = 1 AND (SELECT count(*) FROM user_profiles) = 1
                  AND (SELECT count(*) FROM audit_records WHERE action IN ('auth.register.succeeded', 'auth.external_identity.registered')) = 1
                """;
            Assert.True((bool)(await command.ExecuteScalarAsync(cancellationToken))!);
            await gate.PauseAsync(transaction.Connection!);
            return result;
        }
    }
}
