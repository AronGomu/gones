using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Gones.Infrastructure.Workers;

// Linux statx has a fixed ABI; FileInfo does not distinguish a socket from a regular file.
[SupportedOSPlatform("linux")]
internal static class WorkerWakeSocketPath
{
    private const ushort TypeMask = 0xf000;
    internal const ushort SocketType = 0xc000;
    internal const ushort RegularFileType = 0x8000;
    private const ushort DirectoryType = 0x4000;

    internal static void ValidateParent(string socketPath)
    {
        var owner = GetEffectiveUserId();
        var directory = new DirectoryInfo(Path.GetDirectoryName(socketPath)!);
        var immediate = true;
        while (directory is not null)
        {
            var info = Read(directory.FullName) ?? throw new InvalidOperationException("Worker wake directory is missing.");
            if (info.Type != DirectoryType || (info.UserId != 0 && info.UserId != owner)
                || (info.Mode & 0x12) != 0
                || (immediate && (info.UserId != owner || (info.Mode & 0x1ff) != 0x1c0)))
                throw new InvalidOperationException("Worker wake directory must be private, owned, and free of symlinks.");
            immediate = false;
            directory = directory.Parent;
        }
    }

    internal static FileIdentity? RequireOwnedType(string path, ushort type)
    {
        var info = Read(path);
        if (info is { } value && (value.Type != type || value.UserId != GetEffectiveUserId()))
            throw new InvalidOperationException("Worker wake path has an unsafe type or owner.");
        return info;
    }

    internal static bool DeleteIfUnchanged(string path, FileIdentity expected)
    {
        if (Read(path) != expected) return false;
        // Parent permissions + exclusive ownership exclude untrusted replacement during this final unlink.
        File.Delete(path);
        return true;
    }

    internal static FileIdentity? Read(string path)
    {
        // AT_SYMLINK_NOFOLLOW; request type, mode, uid, inode, device identity.
        if (Statx(-100, path, 0x100, 0x7ff, out var stat) == 0)
            return new FileIdentity(stat.Mode, stat.UserId, stat.Inode, stat.DeviceMajor, stat.DeviceMinor);
        if (Marshal.GetLastPInvokeError() == 2) return null;
        throw new IOException("Worker wake path could not be inspected.");
    }

    internal readonly record struct FileIdentity(ushort Mode, uint UserId, ulong Inode, uint DeviceMajor, uint DeviceMinor)
    {
        public ushort Type => (ushort)(Mode & TypeMask);
    }

    [StructLayout(LayoutKind.Explicit, Size = 256)]
    private struct StatxResult
    {
        [FieldOffset(20)] public uint UserId;
        [FieldOffset(28)] public ushort Mode;
        [FieldOffset(32)] public ulong Inode;
        [FieldOffset(136)] public uint DeviceMajor;
        [FieldOffset(140)] public uint DeviceMinor;
    }

    [DllImport("libc", EntryPoint = "statx", SetLastError = true)]
    private static extern int Statx(int directory, [MarshalAs(UnmanagedType.LPUTF8Str)] string path, int flags, uint mask, out StatxResult result);

    [DllImport("libc", EntryPoint = "geteuid")]
    private static extern uint GetEffectiveUserId();
}
