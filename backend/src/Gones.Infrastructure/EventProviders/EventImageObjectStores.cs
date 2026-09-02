using System.Net;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Gones.Application.Events;

namespace Gones.Infrastructure.EventProviders;

public sealed class S3EventImageObjectStore(IAmazonS3 client, EventImageStorageOptions options) : IEventImageObjectStore
{
    public async Task PutAsync(string key, Stream content, string contentType, CancellationToken cancellationToken)
    {
        try
        {
            _ = await client.PutObjectAsync(new PutObjectRequest
            {
                BucketName = options.Bucket,
                Key = key,
                InputStream = content,
                ContentType = contentType,
                AutoCloseStream = false
            }, cancellationToken);
        }
        catch (Exception exception) when (IsUnavailable(exception, cancellationToken))
        {
            throw new EventImageStorageUnavailableException();
        }
    }

    public async Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken)
    {
        try
        {
            var response = await client.GetObjectAsync(options.Bucket, key, cancellationToken);
            return new ResponseOwnedStream(response);
        }
        catch (AmazonS3Exception exception) when (IsMissingObject(exception))
        {
            throw new KeyNotFoundException($"Event image object '{key}' was not found.", exception);
        }
        catch (Exception exception) when (IsUnavailable(exception, cancellationToken))
        {
            throw new EventImageStorageUnavailableException();
        }
    }

    public async Task DeleteAsync(string key, CancellationToken cancellationToken)
    {
        try
        {
            _ = await client.DeleteObjectAsync(options.Bucket, key, cancellationToken);
        }
        catch (Exception exception) when (IsUnavailable(exception, cancellationToken))
        {
            throw new EventImageStorageUnavailableException();
        }
    }

    internal static IAmazonS3 CreateClient(EventImageStorageOptions options) => new AmazonS3Client(
        new BasicAWSCredentials(options.AccessKey, options.SecretKey),
        new AmazonS3Config
        {
            ServiceURL = options.Endpoint.ToString().TrimEnd('/'),
            AuthenticationRegion = options.Region,
            ForcePathStyle = true,
            MaxErrorRetry = 0,
            Timeout = TimeSpan.FromSeconds(10)
        });

    private static bool IsMissingObject(AmazonS3Exception exception) =>
        string.Equals(exception.ErrorCode, "NoSuchKey", StringComparison.Ordinal)
        || string.Equals(exception.ErrorCode, "NotFound", StringComparison.Ordinal)
        || exception.StatusCode == HttpStatusCode.NotFound && string.IsNullOrWhiteSpace(exception.ErrorCode);

    private static bool IsUnavailable(Exception exception, CancellationToken cancellationToken) =>
        exception is AmazonServiceException or AmazonClientException or HttpRequestException
        || exception is OperationCanceledException && !cancellationToken.IsCancellationRequested;

    private sealed class ResponseOwnedStream(GetObjectResponse response) : Stream
    {
        private Stream Inner => response.ResponseStream;
        public override bool CanRead => Inner.CanRead;
        public override bool CanSeek => Inner.CanSeek;
        public override bool CanWrite => Inner.CanWrite;
        public override long Length => Inner.Length;
        public override long Position { get => Inner.Position; set => Inner.Position = value; }
        public override void Flush() => Inner.Flush();
        public override int Read(byte[] buffer, int offset, int count)
        {
            try { return Inner.Read(buffer, offset, count); }
            catch (Exception exception) when (IsUnavailable(exception, CancellationToken.None) || exception is IOException)
            {
                throw new EventImageStorageUnavailableException();
            }
        }
        public override int Read(Span<byte> buffer)
        {
            try { return Inner.Read(buffer); }
            catch (Exception exception) when (IsUnavailable(exception, CancellationToken.None) || exception is IOException)
            {
                throw new EventImageStorageUnavailableException();
            }
        }
        public override long Seek(long offset, SeekOrigin origin) => Inner.Seek(offset, origin);
        public override void SetLength(long value) => Inner.SetLength(value);
        public override void Write(byte[] buffer, int offset, int count) => Inner.Write(buffer, offset, count);
        public override Task FlushAsync(CancellationToken cancellationToken) => Inner.FlushAsync(cancellationToken);
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            try { return await Inner.ReadAsync(buffer, cancellationToken); }
            catch (Exception exception) when (IsUnavailable(exception, cancellationToken) || exception is IOException)
            {
                throw new EventImageStorageUnavailableException();
            }
        }
        public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
        {
            try { return await Inner.ReadAsync(buffer, offset, count, cancellationToken); }
            catch (Exception exception) when (IsUnavailable(exception, cancellationToken) || exception is IOException)
            {
                throw new EventImageStorageUnavailableException();
            }
        }
        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default) => Inner.WriteAsync(buffer, cancellationToken);
        protected override void Dispose(bool disposing)
        {
            if (disposing) response.Dispose();
            base.Dispose(disposing);
        }
        public override ValueTask DisposeAsync()
        {
            response.Dispose();
            GC.SuppressFinalize(this);
            return ValueTask.CompletedTask;
        }
    }
}

public sealed class UnavailableEventImageObjectStore : IEventImageObjectStore
{
    public Task PutAsync(string key, Stream content, string contentType, CancellationToken cancellationToken) =>
        Task.FromException(new EventImageStorageUnavailableException());

    public Task<Stream> OpenReadAsync(string key, CancellationToken cancellationToken) =>
        Task.FromException<Stream>(new EventImageStorageUnavailableException());

    public Task DeleteAsync(string key, CancellationToken cancellationToken) =>
        Task.FromException(new EventImageStorageUnavailableException());
}
