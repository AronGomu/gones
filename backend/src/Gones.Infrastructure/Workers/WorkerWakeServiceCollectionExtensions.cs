using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Gones.Infrastructure.Workers;

public static class WorkerWakeServiceCollectionExtensions
{
    public static IServiceCollection AddWorkerWakeProducer(this IServiceCollection services, IConfiguration configuration)
    {
        var options = WorkerWakeOptions.TryLoad(configuration);
        if (options is null) return services;
        services.AddSingleton(options);
        services.AddSingleton<WorkerWakeClient>();
        services.AddSingleton<WorkerWakeSender>();
        services.AddSingleton<IWorkerWakeNotifier>(provider => provider.GetRequiredService<WorkerWakeSender>());
        services.AddSingleton<WorkerWakeInterceptor>();
        services.AddHostedService(provider => provider.GetRequiredService<WorkerWakeSender>());
        return services;
    }

    public static IServiceCollection AddWorkerWakeReceiver(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton<WorkerWakeSignal>();
        var options = WorkerWakeOptions.TryLoad(configuration);
        if (options is null) return services;
        services.AddSingleton(options);
        services.AddHostedService<WorkerWakeServer>();
        return services;
    }
}

internal sealed class WorkerWakeSender(WorkerWakeClient client) : BackgroundService, IWorkerWakeNotifier
{
    private readonly WorkerWakeSignal pending = new();
    public void Notify() => pending.Notify();

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            while (await pending.WaitAsync(Timeout.InfiniteTimeSpan, stoppingToken))
            {
                await client.SendAsync(stoppingToken);
                await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
    }
}

internal sealed class WorkerWakeServer(WorkerWakeOptions options, WorkerWakeSignal signal, ILogger<WorkerWakeServer> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!OperatingSystem.IsLinux()) throw new InvalidOperationException("Worker wake requires Linux.");
        WorkerWakeListener listener;
        try { listener = new WorkerWakeListener(options); }
        catch (Exception exception)
        {
            logger.LogCritical("Event={Event}; ExceptionType={ExceptionType}", "worker.wake.initialization_failed", exception.GetType().Name);
            throw new InvalidOperationException("Worker wake initialization failed.");
        }
        using (listener)
        {
            logger.LogInformation("Event={Event}", "worker.wake.listening");
            await listener.RunAsync(signal, stoppingToken);
        }
    }
}
