namespace Gones.Worker;

public sealed class Worker(ILogger<Worker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Gones Worker started");
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        do
        {
            logger.LogInformation("Gones Worker heartbeat at {HeartbeatAt}", DateTimeOffset.UtcNow);
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
