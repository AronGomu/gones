using System.Text;
using Gones.Application.Identity;
using Gones.Domain.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;

namespace Gones.Infrastructure.Identity;

public static class LocalIdentityServices
{
    public static IServiceCollection AddGonesLocalIdentity(this IServiceCollection services)
    {
        services.AddSingleton<ICommonPasswordService, BuiltInCommonPasswordService>();
        services.AddIdentityCore<ApplicationUser>(options =>
            {
                options.Password.RequiredLength = 12;
                options.Password.RequiredUniqueChars = 1;
                options.Password.RequireDigit = false;
                options.Password.RequireLowercase = false;
                options.Password.RequireNonAlphanumeric = false;
                options.Password.RequireUppercase = false;
                options.Lockout.AllowedForNewUsers = true;
                options.Lockout.MaxFailedAccessAttempts = 5;
                options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
                options.User.RequireUniqueEmail = true;
                options.User.AllowedUserNameCharacters = null!;
            })
            .AddEntityFrameworkStores<GonesDbContext>();
        services.AddSingleton<ILookupNormalizer, GonesLookupNormalizer>();
        services.AddScoped<IPasswordValidator<ApplicationUser>, GonesPasswordValidator>();
        return services;
    }
}

public sealed class GonesLookupNormalizer : ILookupNormalizer
{
    public string? NormalizeEmail(string? email) => email?.Trim().Normalize(NormalizationForm.FormKC).ToUpperInvariant();
    public string? NormalizeName(string? name) => name is null ? null : Username.Normalize(name);
}

public sealed class GonesPasswordValidator(ICommonPasswordService commonPasswords) : IPasswordValidator<ApplicationUser>
{
    public const int MaximumLength = 128;

    public async Task<IdentityResult> ValidateAsync(UserManager<ApplicationUser> manager, ApplicationUser user, string? password)
    {
        _ = manager;
        ArgumentNullException.ThrowIfNull(user);
        if (password is null || password.Length > MaximumLength)
        {
            return IdentityResult.Failed(new IdentityError { Code = "PasswordLength", Description = "Password must contain between 12 and 128 characters." });
        }
        if (await commonPasswords.IsCommonAsync(password).ConfigureAwait(false))
        {
            return IdentityResult.Failed(new IdentityError { Code = "CommonPassword", Description = "Password is too common." });
        }
        return IdentityResult.Success;
    }
}

public sealed class BuiltInCommonPasswordService : ICommonPasswordService
{
    private static readonly HashSet<string> CommonPasswords = new(StringComparer.OrdinalIgnoreCase)
    {
        "123456789012",
        "passwordpassword",
        "qwertyqwerty",
        "letmeinletmein",
        "administrator"
    };

    public ValueTask<bool> IsCommonAsync(string password, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return ValueTask.FromResult(CommonPasswords.Contains(password));
    }
}
