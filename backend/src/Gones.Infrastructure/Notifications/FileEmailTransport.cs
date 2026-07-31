using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Gones.Application.Notifications;
using NodaTime;

namespace Gones.Infrastructure.Notifications;

public sealed class FileEmailTransport(string sinkPath, IClock clock) : IEmailTransport
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };

    public async Task SendAsync(OutgoingEmail email, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(email);
        Directory.CreateDirectory(sinkPath);
        var fileName = $"{Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(email.DedupeKey)))}.json";
        var destination = Path.Combine(sinkPath, fileName);
        if (File.Exists(destination)) return;

        var temporary = Path.Combine(sinkPath, $".{fileName}.{Guid.NewGuid():N}.tmp");
        var preview = new FileEmailPreview(
            email.OutboxId,
            email.TemplateKey,
            MaskRecipient(email.Recipient),
            email.Content.Subject,
            email.Content.SafePreviewHtmlBody,
            email.Content.SafePreviewTextBody,
            clock.GetCurrentInstant().ToString());
        try
        {
            await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await JsonSerializer.SerializeAsync(stream, preview, JsonOptions, cancellationToken);
                await stream.FlushAsync(cancellationToken);
            }
            if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(temporary, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            try
            {
                File.Move(temporary, destination, overwrite: false);
            }
            catch (IOException) when (File.Exists(destination))
            {
                // Another worker accepted the same delivery key first.
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            throw new EmailTransportException("file_sink_unavailable", isTransient: true, exception);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    private static string MaskRecipient(string recipient)
    {
        var separator = recipient.LastIndexOf('@');
        if (separator <= 0 || separator == recipient.Length - 1) return "***";
        return $"{recipient[0]}***@{recipient[(separator + 1)..]}";
    }

    private sealed record FileEmailPreview(
        Guid OutboxId,
        string TemplateKey,
        string Recipient,
        string Subject,
        string HtmlPreview,
        string TextPreview,
        string AcceptedAt);
}
