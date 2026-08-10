export type AuthMode = 'login' | 'register' | 'complete-profile' | 'verify-email' | 'forgot-password' | 'reset-password';

/** Where the return button goes: the menu for the two entry points, sign-in for the recovery pages. */
export function authReturnLink(mode: AuthMode): string[] | null {
  if (mode === 'login' || mode === 'register') return ['/'];
  if (mode === 'complete-profile') return null;
  return ['/login'];
}
