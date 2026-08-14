using Testcontainers.PostgreSql;

namespace Gones.IntegrationTests;

internal sealed class PostgreSqlTestContainer : IAsyncDisposable
{
    private const int MaxStartAttempts = 5;
    private PostgreSqlContainer? activeContainer;
    private int disposed;
    private int startAttempted;

    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        if (Volatile.Read(ref disposed) != 0)
        {
            throw new InvalidOperationException("Cannot start a disposed PostgreSQL test container.");
        }

        if (Interlocked.Exchange(ref startAttempted, 1) != 0)
        {
            throw new InvalidOperationException("PostgreSQL test container start was already requested.");
        }

        for (var attempt = 1; attempt <= MaxStartAttempts; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var candidate = new PostgreSqlBuilder().WithImage("postgres:17-alpine").Build();

            try
            {
                await candidate.StartAsync(cancellationToken);
                activeContainer = candidate;
                return;
            }
            catch (Docker.DotNet.DockerApiException exception) when (
                attempt < MaxStartAttempts && IsTransientPortBindingFailure(exception.ToString()))
            {
                Console.Error.WriteLine(
                    $"PostgreSQL test container start attempt {attempt}/{MaxStartAttempts} hit transient RootlessKit port bind collision; rebuilding.");
            }
            finally
            {
                if (!ReferenceEquals(activeContainer, candidate))
                {
                    await candidate.DisposeAsync();
                }
            }

            await Task.Delay(TimeSpan.FromMilliseconds(100 * (1 << (attempt - 1))), cancellationToken);
        }
    }

    public string GetConnectionString()
    {
        var container = activeContainer;
        if (container is null)
        {
            throw new InvalidOperationException("PostgreSQL test container has not started.");
        }

        return container.GetConnectionString();
    }

    public ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0)
        {
            return ValueTask.CompletedTask;
        }

        var container = Interlocked.Exchange(ref activeContainer, null);
        return container is null ? ValueTask.CompletedTask : container.DisposeAsync();
    }

    internal static bool IsTransientPortBindingFailure(string details) =>
        details.Contains("RootlessKit PortManager.AddPort()", StringComparison.Ordinal) &&
        details.Contains("bind: address already in use", StringComparison.Ordinal);
}
