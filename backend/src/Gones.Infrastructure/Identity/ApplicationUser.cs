using Microsoft.AspNetCore.Identity;

namespace Gones.Infrastructure.Identity;

public sealed class ApplicationUser : IdentityUser<Guid>
{
    public string GlobalRole { get; private set; } = "User";
}
