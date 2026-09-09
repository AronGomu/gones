using System.Globalization;
using System.Net.Mail;
using System.Security.Claims;
using System.Text.Json;
using Gones.Application.Notifications;
using Microsoft.Extensions.Configuration;
using NodaTime;
using NodaTime.Text;

namespace Gones.Infrastructure.Configuration;

/// <summary>Immutable process policy. Applying a revision requires quiescent API/Worker replacement.</summary>
public sealed class StagingAccessPolicy
{
    public const string FileKey = "GONES_STAGING_POLICY_FILE";
    private const string Marker = "[STAGING] ";
    private readonly HashSet<string> invited;
    private readonly HashSet<string> recipients;
    public static StagingAccessPolicy Unrestricted { get; } = new(false, "", Instant.MinValue, [], []);
    public bool IsStaging { get; }
    public string Revision { get; }
    public Instant ValidAfter { get; }

    private StagingAccessPolicy(bool isStaging, string revision, Instant validAfter, HashSet<string> invited, HashSet<string> recipients)
    {
        IsStaging = isStaging;
        Revision = revision;
        ValidAfter = validAfter;
        this.invited = invited;
        this.recipients = recipients;
    }

    public static StagingAccessPolicy Load(IConfiguration configuration, string hostEnvironment)
    {
        var deployment = configuration["GONES_DEPLOYMENT_ENVIRONMENT"];
        if (deployment is not null && deployment is not ("staging" or "production" or "local" or "testing")) throw Invalid();
        var hostStaging = string.Equals(hostEnvironment, "Staging", StringComparison.OrdinalIgnoreCase);
        if (hostStaging && deployment is not null && deployment != "staging") throw Invalid();
        var staging = hostStaging || deployment == "staging";
        var path = configuration[FileKey];
        if (!staging)
        {
            if (path is not null) throw Invalid();
            return Unrestricted;
        }

        try
        {
            using var document = JsonDocument.Parse(ReadPrivateFile(path, 65536), new JsonDocumentOptions { MaxDepth = 4 });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) throw Invalid();
            var fields = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in root.EnumerateObject())
            {
                if (property.Name is not ("revision" or "validAfterUtc" or "invitedEmails" or "recipientEmails") || !fields.Add(property.Name)) throw Invalid();
            }
            if (fields.Count != 4) throw Invalid();
            var revision = root.GetProperty("revision").GetString();
            if (string.IsNullOrEmpty(revision) || revision.Length > 64 || revision.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not '-' and not '_')) throw Invalid();
            var cutoffText = root.GetProperty("validAfterUtc").GetString();
            var cutoff = InstantPattern.ExtendedIso.Parse(cutoffText ?? "");
            if (!cutoff.Success || cutoffText != InstantPattern.CreateWithInvariantCulture("uuuu-MM-dd'T'HH:mm:ss'Z'").Format(cutoff.Value)
                || cutoff.Value > SystemClock.Instance.GetCurrentInstant()) throw Invalid();
            var invited = ReadAddresses(root.GetProperty("invitedEmails"));
            var recipients = ReadAddresses(root.GetProperty("recipientEmails"));
            var owner = NormalizeEmail(configuration["GONES_BOOTSTRAP_ADMIN_EMAIL"]);
            if (owner is null || !invited.Contains(owner) || !recipients.Contains(owner) || !invited.IsSubsetOf(recipients)) throw Invalid();
            return new StagingAccessPolicy(true, revision, cutoff.Value, invited, recipients);
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException or ArgumentException or FormatException)
        {
            throw Invalid();
        }
    }

    public bool IsEligible(string? email) => !IsStaging || NormalizeEmail(email) is { } normalized && invited.Contains(normalized);
    public bool IsCurrent(Instant issuedAt) => !IsStaging || issuedAt >= ValidAfter;

    public bool IsCurrentJwt(ClaimsPrincipal principal)
    {
        if (!IsStaging) return true;
        var claims = principal.FindAll("iat").ToArray();
        return claims.Length == 1
            && long.TryParse(claims[0].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var seconds)
            && seconds.ToString(CultureInfo.InvariantCulture) == claims[0].Value
            && seconds >= ValidAfter.ToUnixTimeSeconds()
            && seconds <= Instant.MaxValue.ToUnixTimeSeconds();
    }

    public OutgoingEmail PrepareEmail(OutgoingEmail email)
    {
        if (!IsStaging) return email;
        if (NormalizeEmail(email.Recipient) is not { } normalized || !recipients.Contains(normalized))
            throw new EmailTransportException("staging_recipient_blocked", isTransient: false);
        var subject = email.Content.Subject;
        while (subject.StartsWith(Marker, StringComparison.Ordinal)) subject = subject[Marker.Length..];
        return email with { Content = email.Content with { Subject = Marker + subject } };
    }

    internal static byte[] ReadPrivateFile(string? path, int maximumBytes)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path)) throw Invalid();
            using var stream = File.OpenRead(path);
            var bytes = new byte[maximumBytes + 1];
            var count = 0;
            while (count < bytes.Length)
            {
                var read = stream.Read(bytes, count, bytes.Length - count);
                if (read == 0) break;
                count += read;
            }
            if (count == 0 || count > maximumBytes) throw Invalid();
            return bytes[..count];
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            throw Invalid();
        }
    }

    private static HashSet<string> ReadAddresses(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array) throw Invalid();
        var addresses = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String || NormalizeEmail(item.GetString()) is not { } email || !addresses.Add(email)) throw Invalid();
        }
        if (addresses.Count == 0) throw Invalid();
        return addresses;
    }

    private static string? NormalizeEmail(string? value)
    {
        if (value is null || value.Any(c => c < ' ' || c > '~')) return null;
        var email = value.Trim(' ');
        if (email.Length is 0 or > 254 || email.Contains('*') || email.Contains(' ')
            || !MailAddress.TryCreate(email, out var parsed) || parsed.Address != email) return null;
        return email.ToUpperInvariant();
    }

    private static InvalidOperationException Invalid() => new("staging_policy_invalid");
}
