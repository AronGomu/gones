using System.Diagnostics;
using System.Reflection;
using System.Xml.Linq;

namespace Gones.ArchitectureTests;

public sealed class DependencyDirectionTests
{
    [Theory]
    [MemberData(nameof(ProjectDependencies))]
    public void Project_references_match_allowed_edges(string projectPath, string[] allowedReferences)
    {
        var project = XDocument.Load(Path.Combine(BackendRoot(), projectPath));
        var actual = project
            .Descendants("ProjectReference")
            .Select(element => Path.GetFileNameWithoutExtension(element.Attribute("Include")?.Value.Replace('\\', Path.DirectorySeparatorChar)))
            .Order(StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(allowedReferences.Order(StringComparer.Ordinal), actual);
    }

    [Theory]
    [MemberData(nameof(HostAssemblies))]
    public void Hosts_have_entrypoints(Assembly assembly)
    {
        Assert.NotNull(assembly.EntryPoint);
    }

    [Theory]
    [MemberData(nameof(HelpHosts))]
    public async Task Host_help_exits_successfully(Assembly assembly, string expectedName)
    {
        Assert.Equal(expectedName, assembly.GetName().Name);
        var configuration = AppContext.BaseDirectory.Contains($"{Path.DirectorySeparatorChar}Release{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase)
            ? "Release"
            : "Debug";
        var hostPath = Path.Combine(BackendRoot(), "src", expectedName, "bin", configuration, "net10.0", $"{expectedName}.dll");
        var startInfo = new ProcessStartInfo("dotnet")
        {
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false
        };
        startInfo.ArgumentList.Add(hostPath);
        startInfo.ArgumentList.Add("--help");

        using var process = Process.Start(startInfo);
        Assert.NotNull(process);

        var outputTask = process.StandardOutput.ReadToEndAsync();
        var errorTask = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10));
        var output = await outputTask;
        var error = await errorTask;

        Assert.True(process.ExitCode == 0, $"Exit {process.ExitCode}: {error}");
        Assert.Contains(expectedName, output, StringComparison.Ordinal);
        Assert.Contains("Usage:", output, StringComparison.Ordinal);
    }

    public static TheoryData<string, string[]> ProjectDependencies => new()
    {
        { "src/Gones.Domain/Gones.Domain.csproj", [] },
        { "src/Gones.Application/Gones.Application.csproj", ["Gones.Domain"] },
        { "src/Gones.Infrastructure/Gones.Infrastructure.csproj", ["Gones.Application", "Gones.Domain"] },
        { "src/Gones.Api/Gones.Api.csproj", ["Gones.Application", "Gones.Infrastructure"] },
        { "src/Gones.Worker/Gones.Worker.csproj", ["Gones.Application", "Gones.Infrastructure"] },
        { "src/Gones.Migrator/Gones.Migrator.csproj", ["Gones.Application", "Gones.Infrastructure"] }
    };

    public static TheoryData<Assembly> HostAssemblies => new()
    {
        typeof(Api.AssemblyMarker).Assembly,
        typeof(Worker.AssemblyMarker).Assembly,
        typeof(Migrator.AssemblyMarker).Assembly
    };

    public static TheoryData<Assembly, string> HelpHosts => new()
    {
        { typeof(Worker.AssemblyMarker).Assembly, "Gones.Worker" },
        { typeof(Migrator.AssemblyMarker).Assembly, "Gones.Migrator" }
    };

    private static string BackendRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Gones.sln")))
        {
            directory = directory.Parent;
        }

        return directory?.FullName ?? throw new DirectoryNotFoundException("Could not locate backend/Gones.sln.");
    }
}
