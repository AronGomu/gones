using System.Collections.Concurrent;
using Gones.Application.Events;

namespace Gones.Infrastructure.EventProviders;

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
