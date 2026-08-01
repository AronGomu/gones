using Gones.Domain.Identity;
using Microsoft.AspNetCore.Identity;

namespace Gones.Infrastructure.Identity;

public sealed class ApplicationUser : IdentityUser<Guid>
{
    public string GlobalRole { get; private set; } = GlobalRoles.User;

    public void AssignGlobalRole(string role)
    {
        if (!GlobalRoles.IsKnown(role))
        {
            throw new ArgumentException($"Unknown global role '{role}'.", nameof(role));
        }

        GlobalRole = role;
    }
}
