using System.Net.Mail;
using System.Security.Cryptography;
using Gones.Application.Notifications;
using Gones.Domain.Identity;
using Gones.Domain.Persistence;
using Gones.Infrastructure.Configuration;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using NodaTime;

namespace Gones.Infrastructure.Identity;

public sealed class OwnerSetupOptions
{
    public string Email { get; }
    public string Environment { get; }
    public string PublicOrigin { get; }

    private OwnerSetupOptions(string email, string environment, string origin) => (Email, Environment, PublicOrigin) = (email, environment, origin);

    public static OwnerSetupOptions Load(IConfiguration configuration)
    {
        var email = configuration[AdminBootstrapPolicy.BootstrapEmailKey]?.Trim();
        var environment = configuration["GONES_DEPLOYMENT_ENVIRONMENT"];
        if (email is null || email.Length > 254 || !MailAddress.TryCreate(email, out var parsed) || parsed.Address != email
            || environment is not ("staging" or "production" or "local" or "testing")
            || !Uri.TryCreate(configuration["GONES_PUBLIC_APP_ORIGIN"], UriKind.Absolute, out var origin)
            || origin.Scheme != Uri.UriSchemeHttps || origin.UserInfo.Length != 0 || origin.Query.Length != 0
            || origin.Fragment.Length != 0 || origin.AbsolutePath != "/")
            throw new InvalidOperationException("owner_setup_config_invalid");
        return new OwnerSetupOptions(AdminBootstrapPolicy.NormalizeEmail(email), environment, origin.GetLeftPart(UriPartial.Authority));
    }
}

public sealed record OwnerSetupIssuance(string State, bool Enqueued, bool Succeeded);

public sealed class OwnerSetupService(GonesDbContext database, INotificationOutbox outbox, IClock clock, StagingAccessPolicy policy)
{
    public static Task<OwnerSetup> LockAsync(GonesDbContext database, CancellationToken cancellationToken) =>
        database.OwnerSetups.FromSqlInterpolated($"SELECT * FROM owner_setups WHERE key = {OwnerSetup.SingletonKey} FOR UPDATE")
            .SingleAsync(cancellationToken);

    // Audit actors are nulled on deletion. Retained action names, not surviving user IDs, are authority.
    public static async Task<bool> DisqualifyAsync(GonesDbContext database, OwnerSetup setup, CancellationToken cancellationToken)
    {
        if (setup.CompletedAt is not null) return false;
        var established = await database.Users.AnyAsync(cancellationToken)
            || await database.SystemMarkers.AnyAsync(marker => marker.Key == AdminBootstrapPolicy.MarkerKey && marker.ConsumedAt != null, cancellationToken)
            || await database.AuditRecords.AnyAsync(record => record.Action == "auth.register.succeeded"
                || record.Action == "auth.external_identity.registered" || record.Action == "account.deleted", cancellationToken)
            || await database.Events.AnyAsync(cancellationToken) || await database.Organizations.AnyAsync(cancellationToken)
            || await database.ArchiveLeagues.AnyAsync(cancellationToken) || await database.ArchiveLeagueSeasons.AnyAsync(cancellationToken)
            || await database.ArchiveTournaments.AnyAsync(cancellationToken) || await database.LiveAggregates.AnyAsync(cancellationToken);
        if (established) setup.Disable();
        return established;
    }

    public async Task<OwnerSetupIssuance> IssueAsync(OwnerSetupOptions options, bool resend, CancellationToken cancellationToken = default)
    {
        if (!policy.IsEligible(options.Email)) return new("owner_setup_unavailable", false, false);
        var now = clock.GetCurrentInstant();
        await using var transaction = await database.Database.BeginTransactionAsync(cancellationToken);
        var setup = await LockAsync(database, cancellationToken);
        if (await DisqualifyAsync(database, setup, cancellationToken))
        {
            await database.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new("owner_setup_unavailable", false, false);
        }
        if (!setup.Enabled || setup.OwnerEmail is not null && !setup.Matches(options.Email, options.Environment, options.PublicOrigin))
            return new("owner_setup_unavailable", false, false);
        if (setup.CompletedAt is not null) return new("owner_setup_completed", false, true);
        if (!resend && setup.ExpiresAt > now && setup.IssuedAt is { } issued && policy.IsCurrent(issued))
            return new("owner_setup_pending", false, true);
        if (setup.IssuedAt is { } previous && now < previous + Duration.FromHours(1))
            return new("owner_setup_rate_limited", false, false);
        if (!policy.IsCurrent(now)) return new("owner_setup_unavailable", false, false);
        if (setup.OwnerEmail is null) setup.Bind(options.Email, options.Environment, options.PublicOrigin);
        var plaintext = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        setup.Issue(plaintext, now);
        outbox.Enqueue(new NotificationRequest(options.Email, "fr", $"owner-setup:{Guid.NewGuid():D}",
            new OwnerSetupTemplateModel(new Uri($"{options.PublicOrigin}/owner-setup#token={plaintext}"))));
        database.AuditRecords.Add(new AuditRecord
        {
            Action = "owner.setup.issued", EntityType = "owner_setup", EntityId = OwnerSetup.SingletonKey,
            RedactedDiff = "{\"fields\":[\"generation\"]}", OccurredAt = now
        });
        await database.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new("owner_setup_pending", true, true);
    }
}
