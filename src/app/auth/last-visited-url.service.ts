import { Injectable, signal } from '@angular/core';
import { safeReturnUrl } from './return-url';

/** Path prefixes that belong to the auth flow itself and must never become the post-login destination. */
export const AUTH_PATH_PREFIXES = ['/login', '/register', '/verify-email', '/forgot-password', '/reset-password', '/auth'] as const;

/** Tracks the last non-auth URL visited in this browsing session, so login can return the user there. */
@Injectable({ providedIn: 'root' })
export class LastVisitedUrlService {
  private readonly value = signal('');

  record(url: string): void {
    const path = url.split(/[?#]/)[0] || '/';
    if (AUTH_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return;
    this.value.set(url);
  }

  last(): string {
    return this.value();
  }
}

/** Resolves where to send the user after login: `returnUrl` wins, else the last visited page, else home. */
export function loginDestination(returnUrl: string | null | undefined, lastVisited: string): string {
  return safeReturnUrl(returnUrl, safeReturnUrl(lastVisited, '/'));
}
