using System.Diagnostics.Metrics;
using Gones.Application.Identity;
using Gones.Infrastructure.Identity;
using Gones.Infrastructure.Observability;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Gones.UnitTests;

public sealed class LocalIdentityPolicyTests
{
    [Fact]
    public void Identity_policy_requires_12_to_128_without_composition_and_locks_for_15_minutes()
    {
        var services = new ServiceCollection();
        services.AddGonesLocalIdentity();
        using var provider = services.BuildServiceProvider();
        var options = provider.GetRequiredService<IOptions<IdentityOptions>>().Value;

        Assert.Equal(12, options.Password.RequiredLength);
        Assert.False(options.Password.RequireDigit);
        Assert.False(options.Password.RequireLowercase);
        Assert.False(options.Password.RequireUppercase);
        Assert.False(options.Password.RequireNonAlphanumeric);
        Assert.Equal(5, options.Lockout.MaxFailedAccessAttempts);
        Assert.Equal(TimeSpan.FromMinutes(15), options.Lockout.DefaultLockoutTimeSpan);
        Assert.True(options.User.RequireUniqueEmail);
        Assert.Equal(128, GonesPasswordValidator.MaximumLength);
    }

    [Fact]
    public async Task Common_password_boundary_rejects_common_password()
    {
        var validator = new GonesPasswordValidator(new AlwaysCommonPasswordService());

        var result = await validator.ValidateAsync(null!, new ApplicationUser(), "long-enough-password");

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, error => error.Code == "CommonPassword");
    }

    [Fact]
    public async Task Password_over_128_is_rejected_before_hashing()
    {
        var validator = new GonesPasswordValidator(new NeverCommonPasswordService());

        var result = await validator.ValidateAsync(null!, new ApplicationUser(), new string('x', 129));

        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors, error => error.Code == "PasswordLength");
    }

    [Fact]
    public void Auth_metrics_have_only_low_cardinality_operation_tag()
    {
        var measurements = new List<(string Name, IReadOnlyList<KeyValuePair<string, object?>> Tags)>();
        using var listener = new MeterListener();
        listener.InstrumentPublished = (instrument, activeListener) =>
        {
            if (instrument.Meter.Name == GonesTelemetry.OperationalMeterName) activeListener.EnableMeasurementEvents(instrument);
        };
        listener.SetMeasurementEventCallback<long>((instrument, _, tags, _) =>
            measurements.Add((instrument.Name, tags.ToArray())));
        listener.Start();
        using var metrics = new OperationalMetrics();

        metrics.RecordAuthSuccess("login");
        metrics.RecordAuthRejection("login");
        metrics.RecordAuthLockout();

        Assert.Equal(3, measurements.Count);
        Assert.All(measurements.SelectMany(item => item.Tags), tag => Assert.Equal("auth.operation", tag.Key));
        Assert.DoesNotContain(measurements.SelectMany(item => item.Tags), tag =>
            tag.Key.Contains("email", StringComparison.OrdinalIgnoreCase)
            || tag.Key.Contains("ip", StringComparison.OrdinalIgnoreCase));
    }

    private sealed class AlwaysCommonPasswordService : ICommonPasswordService
    {
        public ValueTask<bool> IsCommonAsync(string password, CancellationToken cancellationToken = default) => ValueTask.FromResult(true);
    }

    private sealed class NeverCommonPasswordService : ICommonPasswordService
    {
        public ValueTask<bool> IsCommonAsync(string password, CancellationToken cancellationToken = default) => ValueTask.FromResult(false);
    }
}
