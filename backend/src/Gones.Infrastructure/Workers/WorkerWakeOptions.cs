using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;

namespace Gones.Infrastructure.Workers;

public sealed class WorkerWakeOptions
{
    public const string SocketKey = "GONES_WORKER_WAKE_SOCKET";
    public const string TokenKey = "GONES_WORKER_WAKE_TOKEN";
    public string SocketPath { get; }
    internal byte[] Token { get; }

    private WorkerWakeOptions(string socketPath, byte[] token)
    {
        SocketPath = socketPath;
        Token = token;
    }

    public static WorkerWakeOptions? TryLoad(IConfiguration configuration)
    {
        var path = configuration[SocketKey];
        var token = configuration[TokenKey];
        if (string.IsNullOrEmpty(path) && string.IsNullOrEmpty(token)) return null;
        if (!OperatingSystem.IsLinux()) throw new InvalidOperationException("Worker wake requires Linux.");
        if (string.IsNullOrWhiteSpace(path) || !Path.IsPathFullyQualified(path)
            || path != Path.GetFullPath(path) || path.EndsWith('/') || path.Contains('\0')
            || Encoding.UTF8.GetByteCount(path) > 100)
            throw new InvalidOperationException("GONES_WORKER_WAKE_SOCKET must be a canonical absolute path of at most 100 UTF-8 bytes.");
        if (token is null || token.Length != 64 || !token.All(Uri.IsHexDigit))
            throw new InvalidOperationException("GONES_WORKER_WAKE_TOKEN must contain exactly 64 hexadecimal characters.");
        return new WorkerWakeOptions(path, Convert.FromHexString(token));
    }
}

public static class WorkerWakeProtocol
{
    public const int RequestLength = 36;
    public static ReadOnlySpan<byte> Acknowledgement => [0x47, 0x57, 1, 1];

    public static byte[] Request(WorkerWakeOptions options)
    {
        var frame = new byte[RequestLength];
        Acknowledgement.CopyTo(frame);
        options.Token.CopyTo(frame, 4);
        return frame;
    }

    internal static bool Authenticate(ReadOnlySpan<byte> frame, WorkerWakeOptions options) =>
        frame.Length == RequestLength
        && frame[..4].SequenceEqual(Acknowledgement)
        && CryptographicOperations.FixedTimeEquals(frame[4..], options.Token);
}
