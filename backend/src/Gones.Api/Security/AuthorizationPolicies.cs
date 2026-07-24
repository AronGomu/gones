using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;

namespace Gones.Api.Security;

public static class AuthorizationPolicies
{
    public const string User = "user";
    public const string Organizer = "global-organizer";
    public const string Admin = "admin";
    public const string OrganizationMember = "organization-member";
    public const string OrganizationOwner = "organization-owner";

    public static IServiceCollection AddGonesAuthorization(this IServiceCollection services)
    {
        services.AddAuthentication(NoIdentityAuthenticationHandler.SchemeName)
            .AddScheme<AuthenticationSchemeOptions, NoIdentityAuthenticationHandler>(NoIdentityAuthenticationHandler.SchemeName, _ => { });
        services.AddAuthorization(options =>
        {
            options.AddPolicy(User, policy => policy.RequireAuthenticatedUser());
            options.AddPolicy(Organizer, policy => policy.RequireRole("Organizer", "Admin"));
            options.AddPolicy(Admin, policy => policy.RequireRole("Admin"));
            options.AddPolicy(OrganizationMember, policy => policy.Requirements.Add(new UnavailableResourceAuthorizationRequirement()));
            options.AddPolicy(OrganizationOwner, policy => policy.Requirements.Add(new UnavailableResourceAuthorizationRequirement()));
        });
        return services;
    }
}

public sealed class UnavailableResourceAuthorizationRequirement : IAuthorizationRequirement;

public sealed class NoIdentityAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IWebHostEnvironment environment) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "gones-no-identity";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!environment.IsEnvironment("Testing") || !Request.Headers.TryGetValue("X-Test-User", out var user))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, user.ToString()) };
        if (Request.Headers.TryGetValue("X-Test-Roles", out var roles))
        {
            claims.AddRange(roles.ToString().Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(role => new Claim(ClaimTypes.Role, role)));
        }
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName));
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName)));
    }
}
