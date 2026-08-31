using Gones.Application.Events;
using Gones.Domain.Calendar;
using Gones.Infrastructure.EventProviders;
using NodaTime;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Metadata.Profiles.Exif;
using SixLabors.ImageSharp.PixelFormats;

namespace Gones.UnitTests;

public sealed class EventImageTests
{
    private static readonly Instant Now = Instant.FromUtc(2030, 1, 1, 12, 0);

    [Fact]
    public void Temporary_state_expires_after_24_hours_and_keeps_ownership_dimensions()
    {
        var id = Guid.NewGuid();
        var owner = Guid.NewGuid();

        var image = EventImage.CreateTemporary(id, owner, 960, 540, Now);

        Assert.Equal(id, image.Id);
        Assert.Equal(owner, image.UploadedByUserId);
        Assert.Equal(EventImageState.Temporary, image.State);
        Assert.Null(image.EventId);
        Assert.Null(image.ProposalId);
        Assert.Null(image.SortOrder);
        Assert.Null(image.AltText);
        Assert.Equal(960, image.Width);
        Assert.Equal(540, image.Height);
        Assert.Equal(Now, image.CreatedAt);
        Assert.Equal(Now + Duration.FromHours(24), image.ExpiresAt);
    }

    [Theory]
    [InlineData(0, 100)]
    [InlineData(100, 0)]
    public void Temporary_state_rejects_invalid_dimensions(int width, int height)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            EventImage.CreateTemporary(Guid.NewGuid(), Guid.NewGuid(), width, height, Now));
    }

    [Fact]
    public async Task Processor_auto_orients_strips_metadata_and_emits_ordered_no_upscale_variants()
    {
        using var source = new Image<Rgba32>(640, 320);
        source.Metadata.ExifProfile = new ExifProfile();
        source.Metadata.ExifProfile.SetValue(ExifTag.Orientation, (ushort)6);
        await using var encoded = new MemoryStream();
        await source.SaveAsJpegAsync(encoded, new JpegEncoder());
        encoded.Position = 0;

        var result = await new ImageSharpEventImageProcessor().ProcessAsync(encoded, "image/jpeg", CancellationToken.None);

        Assert.Equal(320, result.Width);
        Assert.Equal(640, result.Height);
        var variant = Assert.Single(result.Variants);
        Assert.Equal(320, variant.Width);
        Assert.Equal(640, variant.Height);
        using var decoded = Image.Load(variant.WebP.Span);
        Assert.Null(decoded.Metadata.ExifProfile);
        Assert.Null(decoded.Metadata.IccProfile);
        Assert.Equal(320, decoded.Width);
        Assert.Equal(640, decoded.Height);
    }

    [Fact]
    public async Task Processor_emits_standard_variants_in_ascending_order_without_upscale()
    {
        using var source = new Image<Rgba32>(1800, 900);
        await using var encoded = new MemoryStream();
        await source.SaveAsPngAsync(encoded);
        encoded.Position = 0;

        var result = await new ImageSharpEventImageProcessor().ProcessAsync(encoded, "image/png", CancellationToken.None);

        Assert.Equal(1800, result.Width);
        Assert.Equal(900, result.Height);
        Assert.Equal(new[] { 320, 960, 1600 }, result.Variants.Select(variant => variant.Width));
        Assert.Equal(new[] { 160, 480, 800 }, result.Variants.Select(variant => variant.Height));
    }

    [Fact]
    public async Task Processor_emits_source_width_for_tiny_image_without_upscale()
    {
        using var source = new Image<Rgba32>(200, 100);
        await using var encoded = new MemoryStream();
        await source.SaveAsPngAsync(encoded);
        encoded.Position = 0;

        var result = await new ImageSharpEventImageProcessor().ProcessAsync(encoded, "image/png", CancellationToken.None);

        var variant = Assert.Single(result.Variants);
        Assert.Equal(200, variant.Width);
        Assert.Equal(100, variant.Height);
    }

    [Fact]
    public async Task Processor_rejects_declared_decoded_mime_mismatch()
    {
        using var source = new Image<Rgba32>(10, 10);
        await using var encoded = new MemoryStream();
        await source.SaveAsPngAsync(encoded);
        encoded.Position = 0;

        await Assert.ThrowsAsync<EventImageTypeUnsupportedException>(() =>
            new ImageSharpEventImageProcessor().ProcessAsync(encoded, "image/jpeg", CancellationToken.None));
    }

    [Fact]
    public async Task Processor_rejects_more_than_25_megapixels_before_decode()
    {
        await using var encoded = new MemoryStream(PngHeader(5001, 5000));

        await Assert.ThrowsAsync<EventImageTooManyPixelsException>(() =>
            new ImageSharpEventImageProcessor().ProcessAsync(encoded, "image/png", CancellationToken.None));
    }

    [Fact]
    public async Task Processor_rejects_animated_WebP()
    {
        using var source = new Image<Rgba32>(20, 20);
        source.Frames.AddFrame(source.Frames.RootFrame);
        await using var encoded = new MemoryStream();
        await source.SaveAsWebpAsync(encoded, new WebpEncoder());
        encoded.Position = 0;

        await Assert.ThrowsAsync<EventImageAnimatedException>(() =>
            new ImageSharpEventImageProcessor().ProcessAsync(encoded, "image/webp", CancellationToken.None));
    }

    private static byte[] PngHeader(int width, int height)
    {
        var bytes = Convert.FromHexString("89504E470D0A1A0A0000000D4948445200000000000000000806000000000000000000000049454E44AE426082");
        System.Buffers.Binary.BinaryPrimitives.WriteInt32BigEndian(bytes.AsSpan(16, 4), width);
        System.Buffers.Binary.BinaryPrimitives.WriteInt32BigEndian(bytes.AsSpan(20, 4), height);
        var crc = Crc32(bytes.AsSpan(12, 17));
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(29, 4), crc);
        return bytes;
    }

    private static uint Crc32(ReadOnlySpan<byte> bytes)
    {
        uint crc = 0xffffffff;
        foreach (var value in bytes)
        {
            crc ^= value;
            for (var bit = 0; bit < 8; bit++) crc = (crc >> 1) ^ (0xedb88320u & (uint)-(int)(crc & 1));
        }
        return ~crc;
    }
}
