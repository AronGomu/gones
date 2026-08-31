using Gones.Application.Events;
using Gones.Domain.Calendar;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Processing;

namespace Gones.Infrastructure.EventProviders;

public sealed class ImageSharpEventImageProcessor : IEventImageProcessor
{
    public async Task<ProcessedEventImage> ProcessAsync(
        Stream source,
        string contentType,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (!EventImageUploadLimits.ContentTypes.Contains(contentType)) throw new EventImageTypeUnsupportedException();

        await using var buffer = new MemoryStream();
        try
        {
            await source.CopyToAsync(buffer, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            throw new EventImageInvalidException();
        }
        if (buffer.Length > EventImageUploadLimits.MaximumBytes) throw new EventImageTooLargeException();
        buffer.Position = 0;

        ImageInfo info;
        IImageFormat detected;
        try
        {
            info = await Image.IdentifyAsync(buffer, cancellationToken) ?? throw new EventImageInvalidException();
            buffer.Position = 0;
            detected = await Image.DetectFormatAsync(buffer, cancellationToken) ?? throw new EventImageInvalidException();
        }
        catch (EventImageInvalidException)
        {
            throw;
        }
        catch (Exception exception) when (exception is UnknownImageFormatException or InvalidImageContentException or NotSupportedException)
        {
            throw new EventImageInvalidException();
        }

        if (!string.Equals(detected.DefaultMimeType, contentType, StringComparison.OrdinalIgnoreCase))
        {
            throw new EventImageTypeUnsupportedException();
        }
        if ((long)info.Width * info.Height > EventImageUploadLimits.MaximumPixels)
        {
            throw new EventImageTooManyPixelsException();
        }

        buffer.Position = 0;
        using Image image = await LoadAsync(buffer, cancellationToken);
        if (image.Frames.Count != 1) throw new EventImageAnimatedException();
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

    private static async Task<Image> LoadAsync(Stream source, CancellationToken cancellationToken)
    {
        try
        {
            return await Image.LoadAsync(source, cancellationToken);
        }
        catch (Exception exception) when (exception is UnknownImageFormatException or InvalidImageContentException or NotSupportedException)
        {
            throw new EventImageInvalidException();
        }
    }
}
