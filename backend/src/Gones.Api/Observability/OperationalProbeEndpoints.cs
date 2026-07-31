using Gones.Application.Notifications;
using Gones.Infrastructure.Persistence;

namespace Gones.Api.Observability;

public static class OperationalProbeEndpoints
{
    public const string EnabledKey = "GONES_ALLOW_TEST_NOTIFICATION";

    public static void MapOperationalProbeEndpoints(this WebApplication app)
    {
        if (!app.Configuration.GetValue<bool>(EnabledKey)) return;

        app.MapPost("/ops/probes/notification", async (
            INotificationOutbox outbox,
            GonesDbContext database,
            CancellationToken cancellationToken) =>
        {
            var id = outbox.Enqueue(new NotificationRequest(
                "local-recipient@example.test",
                "en",
                $"c07-telemetry-{Guid.NewGuid():N}",
                new VerifyEmailTemplateModel("Local telemetry probe", new Uri("https://localhost/verify?token=local-test-token"))));
            await database.SaveChangesAsync(cancellationToken);
            return Results.Accepted(value: new { id });
        }).AllowAnonymous();
    }
}
