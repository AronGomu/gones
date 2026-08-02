using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Gones.Application.Notifications;
using Gones.Domain.Identity;
using Gones.Domain.Notifications;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using Testcontainers.PostgreSql;

namespace Gones.IntegrationTests;

public sealed class BrevoWebhookAndAdminTests : IAsyncLifetime
{
    private static readonly string WebhookToken = $"c28_{new string('w', 40)}";
    private static readonly string SigningKey = new('x', 48);
    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder().WithImage("postgres:17-alpine").Build();
    private readonly MutableClock clock = new(Instant.FromUtc(2026, 8, 2, 19, 0));
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using (var database = CreateContext()) await database.Database.MigrateAsync();
        factory = CreateFactory();
        client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });
    }

    public async Task DisposeAsync()
    {
        client?.Dispose();
        if (factory is not null) await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Webhook_auth_schema_https_and_replay_are_enforced_without_storing_recipient_content()
    {
        var outboxId = await CreateReconciliationAsync();
        var payload = new Dictionary<string, object?>
        {
            ["event"] = "delivered",
            ["id"] = Random.Shared.Next(1, int.MaxValue),
            ["message-id"] = "provider-message-1",
            ["tag"] = outboxId.ToString("N"),
            ["ts_event"] = 1785697200L,
            ["email"] = "ignored@example.test",
            ["subject"] = "ignored content"
        };

        using var wrongToken = await Client.PostAsJsonAsync("/api/notifications/webhooks/brevo/wrong-token", payload);
        Assert.Equal(HttpStatusCode.NotFound, wrongToken.StatusCode);
        using var malformed = await Client.PostAsJsonAsync($"/api/notifications/webhooks/brevo/{WebhookToken}", new { @event = "delivered" });
        Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
        var unknownPayload = new Dictionary<string, object?>(payload) { ["event"] = "unknown" };
        using var unknown = await Client.PostAsJsonAsync($"/api/notifications/webhooks/brevo/{WebhookToken}", unknownPayload);
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        using var accepted = await Client.PostAsJsonAsync($"/api/notifications/webhooks/brevo/{WebhookToken}", payload);
        using var replay = await Client.PostAsJsonAsync($"/api/notifications/webhooks/brevo/{WebhookToken}", payload);

        Assert.Equal(HttpStatusCode.NoContent, accepted.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, replay.StatusCode);
        await using var verify = CreateContext();
        var record = await verify.NotificationOutboxRecords.SingleAsync(item => item.Id == outboxId);
        Assert.Equal(NotificationOutboxStatus.Sent, record.Status);
        Assert.Equal(NotificationDeliveryStatus.Delivered, record.DeliveryStatus);
        Assert.Equal("provider-message-1", record.ProviderMessageId);
        Assert.Null(record.Recipient);
        Assert.Null(record.TemplateModelJson);
        var delivery = await verify.NotificationDeliveryEvents.SingleAsync(item => item.OutboxId == outboxId);
        Assert.Equal(64, delivery.ReplayKey.Length);
        Assert.DoesNotContain("ignored", JsonSerializer.Serialize(delivery), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Webhook_rejects_non_https_oversized_and_rate_excess()
    {
        using var insecure = factory!.CreateClient();
        var outboxId = await CreateReconciliationAsync();
        var payload = Payload(outboxId, $"evt-{Guid.NewGuid():N}");
        using var nonHttps = await insecure.PostAsJsonAsync($"/api/notifications/webhooks/brevo/{WebhookToken}", payload);
        Assert.Equal(HttpStatusCode.BadRequest, nonHttps.StatusCode);

        using var oversizedBody = new StringContent(JsonSerializer.Serialize(new { payload, padding = new string('x', 33 * 1024) }), Encoding.UTF8, "application/json");
        using var oversized = await Client.PostAsync($"/api/notifications/webhooks/brevo/{WebhookToken}", oversizedBody);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, oversized.StatusCode);

        await using var limitedFactory = CreateFactory(rateLimit: 1);
        using var limited = limitedFactory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });
        using var first = await limited.PostAsJsonAsync($"/api/notifications/webhooks/brevo/{WebhookToken}", payload);
        using var second = await limited.PostAsJsonAsync($"/api/notifications/webhooks/brevo/{WebhookToken}", Payload(outboxId, $"evt-{Guid.NewGuid():N}"));
        Assert.Equal(HttpStatusCode.NoContent, first.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, second.StatusCode);
    }

    [Fact]
    public async Task Admin_lists_safe_metadata_and_approved_retry_creates_audited_new_attempt()
    {
        var outboxId = await CreateReconciliationAsync();
        var adminEmail = $"c28-admin-{Guid.NewGuid():N}@example.test";
        var token = await RegisterAdminAndLoginAsync(adminEmail);
        using var listRequest = AdminRequest(HttpMethod.Get, "/api/admin/notifications/dead-letters", token);
        using var list = await Client.SendAsync(listRequest);
        var listBody = await list.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        var item = listBody.GetProperty("items").EnumerateArray().Single(entry => entry.GetProperty("id").GetGuid() == outboxId);
        Assert.Equal(outboxId, item.GetProperty("id").GetGuid());
        Assert.False(item.TryGetProperty("recipient", out _));
        Assert.False(item.TryGetProperty("templateModelJson", out _));

        using var deniedRequest = AdminRequest(HttpMethod.Post, $"/api/admin/notifications/dead-letters/{outboxId:D}/retry", token, new { operatorApproved = false });
        using var denied = await Client.SendAsync(deniedRequest);
        Assert.Equal(HttpStatusCode.BadRequest, denied.StatusCode);
        using var retryRequest = AdminRequest(HttpMethod.Post, $"/api/admin/notifications/dead-letters/{outboxId:D}/retry", token, new { operatorApproved = true });
        using var retry = await Client.SendAsync(retryRequest);
        Assert.Equal(HttpStatusCode.Created, retry.StatusCode);

        await using var verify = CreateContext();
        var original = await verify.NotificationOutboxRecords.SingleAsync(item => item.Id == outboxId);
        Assert.Equal(NotificationOutboxStatus.DeadLetter, original.Status);
        Assert.Null(original.Recipient);
        Assert.Null(original.TemplateModelJson);
        var replacement = await verify.NotificationOutboxRecords.SingleAsync(item => item.DedupeKey.StartsWith($"operator-retry:{outboxId:N}:"));
        Assert.Equal(NotificationOutboxStatus.Pending, replacement.Status);
        Assert.NotNull(replacement.Recipient);
        Assert.True(await verify.AuditRecords.AnyAsync(item => item.Action == "notification.delivery.retry" && item.EntityId == outboxId.ToString("D")));
    }

    [Fact]
    public async Task Metadata_cleanup_aggregates_then_deletes_events_and_scrubs_old_reconciliation_payload()
    {
        var outboxId = await CreateReconciliationAsync();
        await using (var seed = CreateContext())
        {
            seed.NotificationDeliveryEvents.Add(NotificationDeliveryEvent.Create("old-event", outboxId, "provider-old", NotificationDeliveryStatus.SoftBounce, clock.GetCurrentInstant() - Duration.FromDays(366), clock.GetCurrentInstant() - Duration.FromDays(366)));
            await seed.SaveChangesAsync();
        }
        clock.Advance(Duration.FromDays(366));
        await using (var clean = CreateContext())
        {
            var cleaner = new NotificationDeliveryMetadataCleaner(clean, clock, new NotificationMetrics());
            Assert.Equal(2, await cleaner.CleanBatchAsync(CancellationToken.None));
        }
        await using var verify = CreateContext();
        Assert.False(await verify.NotificationDeliveryEvents.AnyAsync(item => item.ReplayKey == "old-event"));
        var record = await verify.NotificationOutboxRecords.SingleAsync(item => item.Id == outboxId);
        Assert.Equal(NotificationOutboxStatus.DeadLetter, record.Status);
        Assert.Null(record.Recipient);
        Assert.Null(record.TemplateModelJson);
        Assert.NotNull(record.DeliveryMetadataScrubbedAt);
        Assert.Null(record.ProviderMessageId);
        Assert.Null(record.DeliveryStatus);
    }

    private async Task<Guid> CreateReconciliationAsync()
    {
        await using var database = CreateContext();
        var outbox = new NotificationOutbox(database, clock);
        var id = outbox.Enqueue(new NotificationRequest(
            "alice@example.test",
            "en",
            $"brevo-{Guid.NewGuid():N}",
            new VerifyEmailTemplateModel("Alice", new Uri("https://app.example/verify"))));
        await database.SaveChangesAsync();
        var record = await database.NotificationOutboxRecords.SingleAsync(item => item.Id == id);
        var lease = record.Claim(clock.GetCurrentInstant(), Duration.FromMinutes(2));
        record.MarkReconciliation(lease, clock.GetCurrentInstant(), "brevo_acceptance_uncertain");
        await database.SaveChangesAsync();
        return id;
    }

    private WebApplicationFactory<Program> CreateFactory(int rateLimit = 100) =>
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
            builder.UseSetting("GONES_BREVO_WEBHOOK_PATH_TOKEN", WebhookToken);
            builder.UseSetting("GONES_BREVO_WEBHOOK_RATE_LIMIT_PER_MINUTE", rateLimit.ToString(System.Globalization.CultureInfo.InvariantCulture));
        });

    private static object Payload(Guid outboxId, string eventId) => new Dictionary<string, object?>
    {
        ["event"] = "sent",
        ["id"] = eventId,
        ["message-id"] = "provider-message-rate",
        ["tag"] = outboxId.ToString("N"),
        ["ts_event"] = 1785697200L
    };

    private async Task<string> RegisterAdminAndLoginAsync(string email)
    {
        using var registration = await Client.PostAsJsonAsync("/api/auth/register", new
        {
            email,
            username = $"C28{Guid.NewGuid():N}"[..12],
            password = "valid-password-value",
            firstName = "Test",
            lastName = "Admin"
        });
        Assert.Equal(HttpStatusCode.Created, registration.StatusCode);
        await using (var database = CreateContext())
        {
            var user = await database.Users.SingleAsync(item => item.NormalizedEmail == email.ToUpperInvariant());
            user.EmailConfirmed = true;
            user.AssignGlobalRole(GlobalRoles.Admin);
            user.SecurityStamp = Guid.NewGuid().ToString("N");
            await database.SaveChangesAsync();
        }
        using var login = await Client.PostAsJsonAsync("/api/auth/login", new { email, password = "valid-password-value", deviceLabel = "test" });
        login.EnsureSuccessStatusCode();
        return (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accessToken").GetString()!;
    }

    private static HttpRequestMessage AdminRequest(HttpMethod method, string path, string token, object? body = null)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (body is not null) request.Content = JsonContent.Create(body);
        return request;
    }

    private HttpClient Client => client ?? throw new InvalidOperationException("Client not initialized.");

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .UseNpgsql(postgres.GetConnectionString(), npgsql => npgsql.UseNodaTime())
        .Options);

    private sealed class MutableClock(Instant current) : IClock
    {
        public Instant GetCurrentInstant() => current;
        public void Advance(Duration duration) => current += duration;
    }
}
