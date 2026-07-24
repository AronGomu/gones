namespace Gones.Worker;

public sealed class Worker(ILogger<Worker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Gones Worker started");
        await Task.Delay(Timeout.InfiniteTimeSpan, stoppingToken);
    }
}
