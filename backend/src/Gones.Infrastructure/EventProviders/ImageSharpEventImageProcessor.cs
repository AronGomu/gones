using Gones.Application.Events;
using Gones.Domain.Calendar;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Memory;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace Gones.Infrastructure.EventProviders;

public sealed class ImageSharpEventImageProcessor : IEventImageProcessor
{
    private const int MaximumConcurrentProcesses = 2;
    private static readonly SemaphoreSlim ProcessorSlots = new(MaximumConcurrentProcesses, MaximumConcurrentProcesses);
    private static readonly SixLabors.ImageSharp.Configuration ImageConfiguration = CreateConfiguration();
    private static readonly DecoderOptions IdentificationOptions = new()
    {
        Configuration = ImageConfiguration,
        MaxFrames = 2
    };
    private static readonly DecoderOptions DecodeOptions = new()
    {
        Configuration = ImageConfiguration,
        MaxFrames = 1
    };

    public async Task<ProcessedEventImage> ProcessAsync(
        Stream source,
        string contentType,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (!EventImageUploadLimits.ContentTypes.Contains(contentType)) throw new EventImageTypeUnsupportedException();

        await ProcessorSlots.WaitAsync(cancellationToken);
        try
        {
            return await ProcessCoreAsync(source, contentType, cancellationToken);
        }
        finally
        {
            ProcessorSlots.Release();
        }
    }

    private static async Task<ProcessedEventImage> ProcessCoreAsync(
        Stream source,
        string contentType,
        CancellationToken cancellationToken)
    {
        await using var buffer = new MemoryStream();
        await CopyBoundedAsync(source, buffer, cancellationToken);
        buffer.Position = 0;

        ImageInfo info;
        IImageFormat detected;
        try
        {
            info = await Image.IdentifyAsync(IdentificationOptions, buffer, cancellationToken) ?? throw new EventImageInvalidException();
            buffer.Position = 0;
            detected = await Image.DetectFormatAsync(IdentificationOptions, buffer, cancellationToken) ?? throw new EventImageInvalidException();
        }
        catch (EventImageInvalidException)
        {
            throw;
        }
        catch (Exception exception) when (IsInvalidImage(exception))
        {
            throw new EventImageInvalidException();
        }

        if (!string.Equals(detected.DefaultMimeType, contentType, StringComparison.OrdinalIgnoreCase))
        {
            throw new EventImageTypeUnsupportedException();
        }

        var frameCount = Math.Max(1, info.FrameMetadataCollection.Count);
        if ((long)info.Width * info.Height * frameCount > EventImageUploadLimits.MaximumPixels)
        {
            throw new EventImageTooManyPixelsException();
        }
        if (frameCount > 1) throw new EventImageAnimatedException();

        buffer.Position = 0;
        using Image<Rgba32> image = await LoadAsync(buffer, cancellationToken);
        image.Mutate(context => context.AutoOrient());
        image.Metadata.ExifProfile = null;
        image.Metadata.IccProfile = null;
        image.Metadata.XmpProfile = null;

        var sourceWidth = image.Width;
        var sourceHeight = image.Height;
        var variants = new List<ProcessedEventImageVariant>();
        foreach (var width in EventImage.VariantWidthsFor(sourceWidth).OrderDescending())
        {
            if (width != image.Width)
            {
                image.Mutate(context => context.Resize(new ResizeOptions
                {
                    Mode = ResizeMode.Max,
                    Size = new Size(width, image.Height)
                }));
            }
            await using var encoded = new MemoryStream();
            await image.SaveAsWebpAsync(encoded, new WebpEncoder
            {
                FileFormat = WebpFileFormatType.Lossy,
                Quality = 82,
                SkipMetadata = true
            }, cancellationToken);
            variants.Add(new ProcessedEventImageVariant(image.Width, image.Height, encoded.ToArray()));
        }

        return new ProcessedEventImage(sourceWidth, sourceHeight, variants.OrderBy(variant => variant.Width).ToArray());
    }

    private static async Task CopyBoundedAsync(Stream source, Stream destination, CancellationToken cancellationToken)
    {
        var copyBuffer = new byte[81_920];
        long copied = 0;
        try
        {
            while (true)
            {
                var remainingWithSentinel = EventImageUploadLimits.MaximumBytes - copied + 1;
                var read = await source.ReadAsync(
                    copyBuffer.AsMemory(0, (int)Math.Min(copyBuffer.Length, remainingWithSentinel)),
                    cancellationToken);
                if (read == 0) return;
                copied += read;
                if (copied > EventImageUploadLimits.MaximumBytes) throw new EventImageTooLargeException();
                await destination.WriteAsync(copyBuffer.AsMemory(0, read), cancellationToken);
            }
        }
        catch (EventImageTooLargeException)
        {
            throw;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            throw new EventImageInvalidException();
        }
    }

    private static async Task<Image<Rgba32>> LoadAsync(Stream source, CancellationToken cancellationToken)
    {
        try
        {
            return await Image.LoadAsync<Rgba32>(DecodeOptions, source, cancellationToken);
        }
        catch (Exception exception) when (IsInvalidImage(exception))
        {
            throw new EventImageInvalidException();
        }
    }

    private static bool IsInvalidImage(Exception exception) =>
        exception is ImageFormatException or NotSupportedException or InvalidMemoryOperationException;

    private static SixLabors.ImageSharp.Configuration CreateConfiguration()
    {
        var configuration = SixLabors.ImageSharp.Configuration.Default.Clone();
        configuration.MaxDegreeOfParallelism = 1;
        configuration.MemoryAllocator = MemoryAllocator.Create(new MemoryAllocatorOptions
        {
            MaximumPoolSizeMegabytes = 64,
            AllocationLimitMegabytes = 256
        });
        return configuration;
    }
}
