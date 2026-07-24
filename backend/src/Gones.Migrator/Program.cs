if (args.Contains("--help", StringComparer.Ordinal))
{
    Console.WriteLine("Gones.Migrator\n\nUsage: dotnet Gones.Migrator.dll [--help]");
    return;
}

Console.Error.WriteLine("No migration command supplied. Use --help for usage.");
Environment.ExitCode = 2;

public partial class Program;
