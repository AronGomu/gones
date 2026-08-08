# External Identity Link and Unlink Without Reauthentication

## Status

Accepted. Supersedes the step-up check that `POST /api/users/me/external-identities/{provider}/start`
and `DELETE /api/users/me/external-identities/{provider}` carried since the OAuth linking work. The
rest of the account surface is unchanged: `PATCH /api/users/me`, the email change and
`DELETE /api/users/me` still take `currentPassword`.

## Context

Feedback on the profile page, §10 « Comptes liés »: *remove the password requirement to link an
account; remove the input and the conditions.*

Both endpoints ran `ExternalOAuthService.RequireReauthenticationAsync` before doing anything. It had
two branches:

- the caller has a local password → a valid `currentPassword` is required in the request body,
  otherwise `400 validation_failed` naming `currentPassword`;
- the caller has no local password → the access token must have been issued within the last five
  minutes (`iat` claim), otherwise `400` naming `reauthentication`.

The settings form satisfied this with a bare password input sitting above the provider buttons,
outside any form, filled in before clicking "Link" or "Unlink". Two problems with that shape. It
asks for the account password in a context that does not look like an authentication prompt, which
is the exact habit credential-phishing relies on. And the five-minute branch was invisible: a
password-less user who had been signed in for six minutes got a validation error naming a field that
the form does not have and that they could not fill in even if it did.

A step-up check on a state-changing auth operation is worth having. A password textbox embedded in a
settings page is not the way to have one.

## Decision

**Linking and unlinking an external identity require only a valid access token.**

- `LinkStartAsync` and the unlink endpoint take no request body. `LinkExternalIdentityRequest` and
  `UnlinkExternalIdentityRequest` are deleted, so the OpenAPI document and the generated TypeScript
  client no longer carry a `currentPassword` field on either operation.
- `RequireReauthenticationAsync` and its `HasRecentAuthentication` helper are deleted. They had no
  other callers.
- `ExternalOAuthService.UnlinkAsync` loses its `currentPassword` and `ClaimsPrincipal` parameters.
  Its remaining body is unchanged and in the same order: row lock, last-login-method guard, remove,
  revoke sessions, audit, commit.
- The password label and input are gone from the "Comptes liés" card, and `AuthService.startLink` /
  `AuthService.unlink` take only a provider.

## Consequences

### Residual risk

**A stolen access token can now attach an attacker-controlled provider identity to the victim's
account, or detach one, without proving the password.** Attaching is the more serious of the two: it
creates a second, attacker-owned way to sign in that survives a password reset. Before this change,
an attacker holding only an access token was stopped by the password check unless they caught the
token inside its first five minutes.

This is accepted on the strength of the controls below and on the judgement that a password box in a
settings form was not buying real protection — it trained the exact behaviour that makes token theft
easier in the first place.

### Compensating controls, all unchanged

1. **Short-lived access token**, `AccessTokenIssuer.Lifetime` = 15 minutes. That is the whole window
   in which a stolen token is useful; this surface issues no refresh. Every request also re-validates
   the token against the database in `OnTokenValidated`: the user row must still exist and the
   `security_stamp` and `role` claims must still match, so any stamp rotation — password reset,
   account closure, role change — kills the token immediately rather than at expiry. Note that
   linking or unlinking does *not* itself rotate the stamp, so the thief's own token survives the
   operation for the rest of its 15 minutes.
2. **`AuthRateLimiting.IpPolicy`** still applies to both routes, so neither can be driven in bulk.
3. **Full session revocation** — `RefreshSessionService.RevokeAllForIdentityChangeAsync` still runs
   on the link callback *and* on unlink. Any identity change kills every refresh session on the
   account, so the legitimate owner is signed out and will notice, and a stolen refresh cookie dies
   with it.
4. **`LastLoginMethodException`** still refuses to unlink the only remaining login method, returning
   `409 last_login_method`. An account cannot be locked out of itself.
5. **Audit trail** — `auth.external_identity.linked` and `auth.external_identity.unlinked` rows are
   still written inside the same transaction, with the existing redaction: the diff carries the
   provider name only, never the email and never a token.

Authorization (`AuthorizationPolicies.User`) is unchanged and is what an anonymous caller hits first;
link start returns `401` before any body is looked at.

### If a step-up check is restored

Reintroduce it as a **re-authentication ceremony**, not a password field in the settings form: bounce
the user through a dedicated sign-in prompt and mint a freshly-issued token, then gate the operation
on that token's age. That gives the same guarantee without teaching users to type their password into
an ordinary settings page, and it works identically for password-less accounts — the case the deleted
five-minute branch handled badly.
