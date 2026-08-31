using System.Collections.Concurrent;
using Gones.Application.Events;

namespace Gones.Infrastructure.EventProviders;

public sealed class FakeEventLocationProvider : IEventLocationProvider
{
    public Task<IReadOnlyList<EventLocationSuggestion>> AutocompleteAsync(
        string input,
        string sessionToken,
        string language,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var normalized = string.Concat(input.Trim().ToLowerInvariant().Select(character => char.IsLetterOrDigit(character) ? character : '-'));
        IReadOnlyList<EventLocationSuggestion> result =
        [
            new EventLocationSuggestion($"fake-place-{normalized}", input.Trim(), "Deterministic test location")
        ];
        return Task.FromResult(result);
    }

    public Task<ResolvedEventLocation> ResolveAsync(
        string placeId,
        string sessionToken,
        string language,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new ResolvedEventLocation(
            placeId,
            "10 Rue de la République",
            "69001",
            "Lyon",
            "France",
            "Auvergne-Rhône-Alpes",
            45.7640m,
            4.8357m,
            "Europe/Paris"));
    }
}

public sealed class InMemoryEventImageObjectStore : IEventImageObjectStore
{
    private readonly ConcurrentDictionary<string, byte[]> objects = new(StringComparer.Ordinal);

    public async Task PutAsync(string key, Stream content, string contentType, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        await content.CopyToAsync(buffer, cancellationToken);
        objects[key] = buffer.ToArray();
    }

    public Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!objects.TryGetValue(key, out var bytes)) throw new KeyNotFoundException($"Object '{key}' was not found.");
        return Task.FromResult<Stream>(new MemoryStream(bytes, writable: false));
    }

    public Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        objects.TryRemove(key, out _);
        return Task.CompletedTask;
    }
}
