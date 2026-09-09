using NodaTime;

namespace Gones.Domain.Persistence;

public sealed class WorkerMaintenanceState
{
    private WorkerMaintenanceState() { }

    public WorkerMaintenanceState(string key, Instant now)
    {
        Key = key;
        NextDueAt = now;
    }

    public string Key { get; private set; } = string.Empty;
    public Instant? LastSucceededAt { get; private set; }
    public Instant NextDueAt { get; private set; }
    public bool HasFailed { get; private set; }

    public void Complete(Instant now)
    {
        LastSucceededAt = now;
        NextDueAt = now.InUtc().Date.PlusDays(1).AtMidnight().InUtc().ToInstant();
        HasFailed = false;
    }

    public void Fail(Instant now)
    {
        NextDueAt = now + Duration.FromHours(1);
        HasFailed = true;
    }
}
