import { logBoundaryError } from '../shared/app-logger';
import { AuthCoordinationUnavailableError } from './auth-session-coordination.service';
import type { AuthService } from './auth.service';

/**
 * A browser that blocks site data (or has no Web Locks) cannot restore a session, but the public
 * surfaces need none. Swallow exactly that failure so Angular bootstrap continues anonymously;
 * AuthService has already settled bootstrapped/bootstrapFailed before rethrowing (F9).
 */
export async function runAuthBootstrap(auth: Pick<AuthService, 'bootstrap'>): Promise<void> {
  try {
    await auth.bootstrap();
  } catch (error) {
    if (error instanceof AuthCoordinationUnavailableError) {
      logBoundaryError('auth.bootstrap', error, { degraded: 'anonymous' });
      return;
    }
    throw error;
  }
}
