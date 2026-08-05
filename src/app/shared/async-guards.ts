/**
 * Small, dependency-free guards for the two async hazards that show up in every list/form screen:
 * out-of-order responses overwriting newer state, and duplicate submits from double clicks.
 */

/**
 * Stale-response guard. Take a token before an async read; only apply the result when the token is
 * still the newest one. Prevents a slow page-1 response from overwriting a fast page-2 response.
 */
export class LatestRequest {
  private token = 0;

  /** Starts a new request and invalidates every previous one. */
  begin(): number {
    return ++this.token;
  }

  /** True when `token` is the newest request, i.e. its response is safe to apply. */
  isCurrent(token: number): boolean {
    return token === this.token;
  }

  /** Invalidates every in-flight request without starting a new one (teardown, reset). */
  cancel(): void {
    this.token++;
  }
}

/**
 * Pending lock for mutations. A second call while one is in flight is dropped, so a double-click
 * cannot submit twice. Returns `undefined` for the dropped call so callers can tell them apart.
 */
export class PendingLock {
  private running = false;

  get pending(): boolean {
    return this.running;
  }

  async run<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (this.running) return undefined;
    this.running = true;
    try {
      return await task();
    } finally {
      this.running = false;
    }
  }
}
