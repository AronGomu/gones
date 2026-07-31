using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Gones.Api.Health;
using Gones.Application.Notifications;
using Gones.Infrastructure.Notifications;
using Gones.Infrastructure.Observability;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;
using Testcontainers.PostgreSql;

namespace Gones.IntegrationTests;

public sealed class TelemetryAndHealthTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer postgres = new PostgreSqlBuilder().WithImage("postgres:17-alpine").Build();
    private readonly WebApplicationFactory<Program> factory = new();

    public async Task InitializeAsync()
    {
        await postgres.StartAsync();
        await using var database = CreateContext();
        await database.Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        await factory.DisposeAsync();
        await postgres.DisposeAsync();
    }

    [Fact]
    public async Task Trace_and_correlation_propagate_from_api_through_database_outbox_and_worker()
    {
        var activities = new ConcurrentBag<Activity>();
        using var listener = new ActivityListener
        {
            ShouldListenTo = _ => true,
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllDataAndRecorded,
            SampleUsingParentId = (ref ActivityCreationOptions<string> _) => ActivitySamplingResult.AllDataAndRecorded,
            ActivityStopped = activities.Add
        };
        ActivitySource.AddActivityListener(listener);

        var correlationId = Guid.NewGuid().ToString("D");
        using var client = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting(PersistenceServiceCollectionExtensions.ConnectionStringKey, postgres.GetConnectionString());
            builder.UseSetting("GONES_OTEL_CONSOLE_EXPORTER", "false");
            builder.UseSetting("GONES_ALLOW_TEST_NOTIFICATION", "true");
        }).CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/ops/probes/notification");
        request.Headers.Add("X-Correlation-ID", correlationId);
        request.Content = JsonContent.Create(new { });

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        await using var database = CreateContext();
        var record = await database.NotificationOutboxRecords.SingleAsync();
        Assert.Equal(correlationId, record.CorrelationId);
        Assert.False(string.IsNullOrWhiteSpace(record.TraceParent));
        Assert.True(ActivityContext.TryParse(record.TraceParent, null, out var producerContext));
        Assert.Contains(activities, activity =>
            activity.TraceId == producerContext.TraceId
            && activity.Source.Name.Contains("Npgsql", StringComparison.OrdinalIgnoreCase));

        var processor = CreateProcessor(database);
        await processor.ProcessBatchAsync(CancellationToken.None);

        Assert.Contains(activities, activity =>
            activity.OperationName == "notification.process"
            && activity.Kind == ActivityKind.Consumer
            && activity.TraceId == producerContext.TraceId
            && activity.ParentSpanId == producerContext.SpanId
            && activity.GetTagItem("gones.correlation_id")?.ToString() == correlationId);
    }

    [Fact]
    public async Task Health_endpoints_distinguish_live_ready_and_degraded()
    {
        using var client = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting(PersistenceServiceCollectionExtensions.ConnectionStringKey, postgres.GetConnectionString());
            builder.UseSetting("GONES_OTEL_CONSOLE_EXPORTER", "false");
        }).CreateClient();

        using var live = await client.GetAsync("/health/live");
        using var degraded = await client.GetAsync("/health/ready");
        var degradedBody = await degraded.Content.ReadFromJsonAsync<JsonElement>();
        await using (var database = CreateContext())
        {
            await new WorkerHeartbeatStore(database, SystemClock.Instance).RecordAsync(CancellationToken.None);
        }
        using var ready = await client.GetAsync("/health/ready");
        var readyBody = await ready.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, live.StatusCode);
        Assert.Equal(HttpStatusCode.OK, degraded.StatusCode);
        Assert.Equal("Degraded", degradedBody.GetProperty("status").GetString());
        Assert.Equal("Degraded", degradedBody.GetProperty("checks").GetProperty("workerHeartbeat").GetProperty("status").GetString());
        Assert.Equal(HttpStatusCode.OK, ready.StatusCode);
        Assert.Equal("Healthy", readyBody.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Missing_database_is_unhealthy_without_affecting_liveness()
    {
        using var client = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting(PersistenceServiceCollectionExtensions.ConnectionStringKey, string.Empty);
            builder.UseSetting("GONES_OTEL_CONSOLE_EXPORTER", "false");
        }).CreateClient();

        using var live = await client.GetAsync("/health/live");
        using var ready = await client.GetAsync("/health/ready");
        var body = await ready.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, live.StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, ready.StatusCode);
        Assert.Equal("Unhealthy", body.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Worker_heartbeat_health_is_degraded_when_missing_or_stale_then_healthy_when_fresh()
    {
        var clock = new MutableClock(Instant.FromUtc(2026, 7, 31, 12, 0));
        await using var database = CreateContext();
        var check = new WorkerHeartbeatHealthCheck(database, clock, new WorkerHealthOptions(Duration.FromSeconds(30)));

        var missing = await check.CheckHealthAsync(new HealthCheckContext(), CancellationToken.None);
        await new WorkerHeartbeatStore(database, clock).RecordAsync(CancellationToken.None);
        var healthy = await check.CheckHealthAsync(new HealthCheckContext(), CancellationToken.None);
        clock.Advance(Duration.FromMinutes(1));
        var stale = await check.CheckHealthAsync(new HealthCheckContext(), CancellationToken.None);

        Assert.Equal(HealthStatus.Degraded, missing.Status);
        Assert.Equal(HealthStatus.Healthy, healthy.Status);
        Assert.Equal(HealthStatus.Degraded, stale.Status);
    }

    private NotificationProcessor CreateProcessor(GonesDbContext database)
    {
        var clock = SystemClock.Instance;
        return new NotificationProcessor(
            new NotificationOutboxStore(database, clock),
            new NotificationTemplateRenderer(),
            new FakeTransport(),
            DefaultNotificationRetryPolicy.Instance,
            new NotificationMetrics(),
            new NotificationWorkerOptions(10, Duration.FromMilliseconds(100), Duration.FromMinutes(2), Duration.FromSeconds(30), Path.GetTempPath()),
            clock,
            NullLogger<NotificationProcessor>.Instance);
    }

    private GonesDbContext CreateContext() => new(new DbContextOptionsBuilder<GonesDbContext>()
        .ConfigureGones(postgres.GetConnectionString())
        .Options);

    private sealed class FakeTransport : IEmailTransport
    {
        public Task SendAsync(OutgoingEmail email, CancellationToken cancellationToken) => Task.CompletedTask;
    }

    private sealed class MutableClock(Instant current) : IClock
    {
        public Instant GetCurrentInstant() => current;
        public void Advance(Duration duration) => current += duration;
    }
}
