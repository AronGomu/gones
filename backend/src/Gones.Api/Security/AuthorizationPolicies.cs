using System.Security.Claims;
using System.Text;
using System.Text.Encodings.Web;
using Gones.Infrastructure.Configuration;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Gones.Api.Security;

public static class AuthorizationPolicies
{
    public const string User = "user";
    public const string Organizer = "global-organizer";
    public const string Admin = "admin";
    public const string OrganizationMember = "organization-member";
    public const string OrganizationOwner = "organization-owner";

    public const string JwtIssuer = "gones";
    public const string JwtAudience = "gones-api";
    public const string SecurityStampClaim = "security_stamp";

    public static IServiceCollection AddGonesAuthorization(
        this IServiceCollection services,
        GonesRuntimeConfiguration runtimeConfiguration,
        IConfiguration configuration)
    {
        if (runtimeConfiguration.Features.AuthV1)
        {
            var signingKey = configuration["GONES_AUTH_SIGNING_KEY"]
                ?? throw new InvalidOperationException("GONES_AUTH_SIGNING_KEY is required when auth is enabled.");
            services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
                .AddJwtBearer(options =>
                {
                    options.MapInboundClaims = false;
                    options.TokenValidationParameters = new TokenValidationParameters
                    {
                        ValidateIssuer = true,
                        ValidIssuer = JwtIssuer,
                        ValidateAudience = true,
                        ValidAudience = JwtAudience,
                        ValidateIssuerSigningKey = true,
                        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)),
                        ValidateLifetime = true,
                        ClockSkew = TimeSpan.FromSeconds(30),
                        NameClaimType = "sub",
                        RoleClaimType = "role"
                    };
                });
        }
        else
        {
            services.AddAuthentication(NoIdentityAuthenticationHandler.SchemeName)
                .AddScheme<AuthenticationSchemeOptions, NoIdentityAuthenticationHandler>(NoIdentityAuthenticationHandler.SchemeName, _ => { });
        }

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
