namespace Gones.Application.Identity;

public interface ICommonPasswordService
{
    ValueTask<bool> IsCommonAsync(string password, CancellationToken cancellationToken = default);
}
