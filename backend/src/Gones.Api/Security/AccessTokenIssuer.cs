using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Gones.Infrastructure.Identity;
using Microsoft.IdentityModel.Tokens;
using NodaTime;

namespace Gones.Api.Security;

public sealed record AccessToken(string Value, Instant ExpiresAt);

public sealed class AccessTokenIssuer(IConfiguration configuration, IClock clock)
{
    public static readonly Duration Lifetime = Duration.FromMinutes(15);

    public AccessToken Issue(ApplicationUser user)
    {
        var signingKey = configuration["GONES_AUTH_SIGNING_KEY"]
            ?? throw new InvalidOperationException("GONES_AUTH_SIGNING_KEY is required when auth is enabled.");
        var now = clock.GetCurrentInstant();
        var expiresAt = now + Lifetime;
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString("D")),
            new Claim("role", user.GlobalRole),
            new Claim(AuthorizationPolicies.SecurityStampClaim, user.SecurityStamp ?? string.Empty),
            new Claim(JwtRegisteredClaimNames.Iat, now.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture), ClaimValueTypes.Integer64)
        };
        var token = new JwtSecurityToken(
            AuthorizationPolicies.JwtIssuer,
            AuthorizationPolicies.JwtAudience,
            claims,
            now.ToDateTimeUtc(),
            expiresAt.ToDateTimeUtc(),
            new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)), SecurityAlgorithms.HmacSha256));
        return new AccessToken(new JwtSecurityTokenHandler().WriteToken(token), expiresAt);
    }
}
