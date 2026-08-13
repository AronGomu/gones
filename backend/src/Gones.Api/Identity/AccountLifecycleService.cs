using System.Security.Cryptography;
using System.Text;
using Gones.Application.Notifications;
using Gones.Domain.Identity;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Identity;

internal sealed record AccountLifecycleOptions(Uri PublicOrigin)
{
    public static AccountLifecycleOptions Load(IConfiguration configuration)
    {
        var raw = configuration["GONES_PUBLIC_APP_ORIGIN"];
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var origin)
            || origin.Scheme != Uri.UriSchemeHttps
            || !string.IsNullOrEmpty(origin.UserInfo)
            || !string.IsNullOrEmpty(origin.Query)
            || !string.IsNullOrEmpty(origin.Fragment)
            || origin.AbsolutePath != "/")
        {
            throw new InvalidOperationException("GONES_PUBLIC_APP_ORIGIN must be an HTTPS origin.");
        }
        return new AccountLifecycleOptions(new Uri(origin.GetLeftPart(UriPartial.Authority)));
    }
}

internal sealed class AccountLifecycleService(
    GonesDbContext database,
    INotificationOutbox outbox,
    AccountLifecycleOptions options,
    IClock clock)
{
    public async Task IssueAsync(
        ApplicationUser user,
        AccountActionPurpose purpose,
        string username,
        string locale,
        string? targetEmail,
        string? returnUrl,
        CancellationToken cancellationToken)
    {
        var now = clock.GetCurrentInstant();
        var securityStamp = RequiredSecurityStamp(user);
        var active = await database.AccountActionTokens
            .Where(token => token.UserId == user.Id
                && (token.Purpose == purpose
                    || purpose == AccountActionPurpose.ChangeEmail && token.Purpose == AccountActionPurpose.VerifyEmail)
                && token.ConsumedAt == null
                && token.SupersededAt == null)
            .ToListAsync(cancellationToken);
        foreach (var token in active) token.Supersede(now);

        var plaintext = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var normalizedTarget = targetEmail is null ? null : targetEmail.Trim().Normalize(NormalizationForm.FormKC).ToUpperInvariant();
        var record = AccountActionToken.Create(
            user.Id,
            purpose,
            Hash(plaintext),
            securityStamp,
            targetEmail?.Trim(),
            normalizedTarget,
            now);
        database.AccountActionTokens.Add(record);

        var recipient = purpose == AccountActionPurpose.ChangeEmail
            ? record.TargetEmail!
            : user.Email ?? throw new InvalidOperationException("Identity user email is required.");
        var path = purpose switch
        {
            AccountActionPurpose.VerifyEmail => "/verify-email",
            AccountActionPurpose.ResetPassword => "/reset-password",
            AccountActionPurpose.ChangeEmail => "/verify-email-change",
            _ => throw new ArgumentOutOfRangeException(nameof(purpose))
        };
        var query = new Dictionary<string, string?> { ["token"] = plaintext };
        var safeReturnUrl = SafeLocalPath(returnUrl);
        if (safeReturnUrl is not null) query["returnUrl"] = safeReturnUrl;
        var actionUrl = new Uri(options.PublicOrigin, QueryHelpers.AddQueryString(path, query));
        NotificationTemplateModel model = purpose == AccountActionPurpose.ResetPassword
            ? new ResetPasswordTemplateModel(username, actionUrl)
            : new VerifyEmailTemplateModel(username, actionUrl);
        outbox.Enqueue(new NotificationRequest(
            recipient,
            locale,
            $"account-action:{record.Id:D}",
            model,
            user.Id));
    }

    public async Task<AccountActionToken?> LockValidAsync(
        string? plaintext,
        AccountActionPurpose purpose,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(plaintext) || plaintext.Length > 256) return null;
        var hash = Hash(plaintext);
        var token = await database.AccountActionTokens
            .FromSqlInterpolated($"SELECT * FROM account_action_tokens WHERE token_hash = {hash} AND purpose = {purpose.ToString()} FOR UPDATE")
            .SingleOrDefaultAsync(cancellationToken);
        if (token is null) return null;
        var user = await database.Users.SingleOrDefaultAsync(item => item.Id == token.UserId, cancellationToken);
        return user is not null && token.CanConsume(clock.GetCurrentInstant(), RequiredSecurityStamp(user)) ? token : null;
    }

    public Task LockUserAsync(Guid userId, CancellationToken cancellationToken) =>
        database.Users.FromSqlInterpolated($"SELECT * FROM asp_net_users WHERE id = {userId} FOR UPDATE")
            .SingleAsync(cancellationToken);

    public static string Hash(string plaintext) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(plaintext)));

    private static string? SafeLocalPath(string? candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate) || candidate.Length > 2048) return null;
        var value = candidate.Trim();
        if (!value.StartsWith('/') || value.StartsWith("//", StringComparison.Ordinal) || value.Contains('\\')) return null;
        foreach (var character in candidate)
        {
            if (character <= '\u001f' || character == '\u007f') return null;
        }
        return value;
    }

    private static string RequiredSecurityStamp(ApplicationUser user) =>
        string.IsNullOrWhiteSpace(user.SecurityStamp)
            ? throw new InvalidOperationException("Identity user security stamp is required.")
            : user.SecurityStamp;
}
