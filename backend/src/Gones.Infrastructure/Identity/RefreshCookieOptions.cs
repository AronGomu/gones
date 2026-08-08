namespace Gones.Infrastructure.Identity;

/// <summary>
/// Deployment topology of the refresh cookie, bound from <c>Gones:Auth:RefreshCookie</c>.
///
/// The defaults describe the same-site deployment the platform ships with. A frontend served from a
/// different registrable domain than the API needs <c>SameSite=None</c>, which browsers only accept
/// together with <c>Secure</c> over HTTPS; a plain-HTTP development host needs <c>Secure=false</c>
/// or the browser silently drops the cookie and the session never survives a reload.
/// </summary>
public sealed class RefreshCookieOptions
{
    public string SameSite { get; set; } = "Lax";
    public bool Secure { get; set; } = true;
}
