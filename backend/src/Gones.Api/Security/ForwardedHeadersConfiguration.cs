using System.Globalization;
using System.Net;
using Microsoft.AspNetCore.HttpOverrides;
using IPNetwork = System.Net.IPNetwork;

namespace Gones.Api.Security;

/// <summary>
/// Forwarded-header trust for a platform-agnostic deployment (C41, closing the client-IP gap ADR 0017
/// left open).
///
/// The API always terminates plain HTTP inside the container; a host-provided reverse proxy owns TLS.
/// That proxy is the only component allowed to restate the client IP and scheme, so the trust list is
/// explicit and empty by default: with no <c>GONES_FORWARDED_PROXIES</c> the middleware is not even
/// installed and <c>X-Forwarded-*</c> is inert. Anything else would let any caller pick its own rate
/// limit partition and fake HTTPS.
/// </summary>
public sealed record ForwardedProxySettings(
    IReadOnlyList<IPAddress> KnownProxies,
    IReadOnlyList<IPNetwork> KnownNetworks,
    int HopLimit)
{
    public const string ProxiesKey = "GONES_FORWARDED_PROXIES";
    public const string HopLimitKey = "GONES_FORWARDED_PROXY_HOP_LIMIT";

    public bool Enabled => KnownProxies.Count > 0 || KnownNetworks.Count > 0;

    public static ForwardedProxySettings Load(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        var proxies = new List<IPAddress>();
        var networks = new List<IPNetwork>();
        var raw = configuration[ProxiesKey];
        foreach (var entry in (raw ?? string.Empty).Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (entry.Contains('/', StringComparison.Ordinal))
            {
                if (!IPNetwork.TryParse(entry, out var network)) throw new InvalidOperationException($"{ProxiesKey} entry '{entry}' is not an IP network in CIDR form.");
                networks.Add(network);
                continue;
            }

            if (!IPAddress.TryParse(entry, out var address)) throw new InvalidOperationException($"{ProxiesKey} entry '{entry}' is not an IP address.");
            proxies.Add(address);
        }

        var hopRaw = configuration[HopLimitKey];
        var hopLimit = 1;
        if (!string.IsNullOrWhiteSpace(hopRaw)
            && (!int.TryParse(hopRaw, NumberStyles.None, CultureInfo.InvariantCulture, out hopLimit) || hopLimit is < 1 or > 12))
        {
            throw new InvalidOperationException($"{HopLimitKey} must be an integer between 1 and 12.");
        }

        return new ForwardedProxySettings(proxies, networks, hopLimit);
    }

    /// <summary>Applies the trust list, replacing the framework's implicit loopback defaults.</summary>
    public void Apply(ForwardedHeadersOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        // Scheme and client IP only. X-Forwarded-Host is not honoured: hostnames drive absolute link
        // generation and OAuth callbacks, and those come from explicit configuration instead.
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.ForwardLimit = HopLimit;
        options.RequireHeaderSymmetry = false;
        options.KnownProxies.Clear();
        options.KnownIPNetworks.Clear();
        foreach (var proxy in KnownProxies) options.KnownProxies.Add(proxy);
        foreach (var network in KnownNetworks) options.KnownIPNetworks.Add(network);
    }
}
