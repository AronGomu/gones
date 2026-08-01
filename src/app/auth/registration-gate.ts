export function registrationDestination(profile: { emailVerified: boolean }): '/verify-email' | '/login' {
  return profile.emailVerified ? '/login' : '/verify-email';
}
