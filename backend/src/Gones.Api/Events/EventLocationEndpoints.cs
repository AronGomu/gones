using NodaTime;

namespace Gones.Api.Events;

internal static class EventLocationEndpoints
{
    public static void MapEventLocationEndpoints(this WebApplication app)
    {
        app.MapGet("/api/event-locations/time-zones", ListTimeZones)
            .WithName("ListEventTimeZones")
            .AllowAnonymous()
            .Produces<EventTimeZoneCatalogResponse>();
    }

    private static IResult ListTimeZones() =>
        Results.Ok(new EventTimeZoneCatalogResponse(EventTimeZoneCatalog.Ids));
}

internal static class EventTimeZoneCatalog
{
    private static readonly string[] Values = DateTimeZoneProviders.Tzdb.Ids
        .Distinct(StringComparer.Ordinal)
        .Order(StringComparer.Ordinal)
        .ToArray();
    private static readonly IReadOnlySet<string> ValueSet = Values.ToHashSet(StringComparer.Ordinal);

    public static IReadOnlyList<string> Ids => Values;
    public static bool Contains(string id) => ValueSet.Contains(id);
}

internal sealed record EventTimeZoneCatalogResponse(IReadOnlyList<string> Ids);
