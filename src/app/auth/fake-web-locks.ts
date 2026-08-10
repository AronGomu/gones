export class SharedFakeWebLocks {
  private readonly tails = new Map<string, Promise<void>>();

  request<T>(name: string, callback: () => Promise<T> | T): Promise<T> {
    const tail = this.tails.get(name) ?? Promise.resolve();
    const pending = tail.then(callback, callback);
    this.tails.set(name, pending.then(() => undefined, () => undefined));
    return pending;
  }
}

export function installFakeWebLocks(locks = new SharedFakeWebLocks()): SharedFakeWebLocks {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
  return locks;
}

export function removeWebLocks(): void {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
}
