const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * In-memory limit on sessions per rolling 24 hours. Best effort: it resets when the process
 * restarts. The hard limit on spending is the budget of the OpenAI project.
 */
export class SessionLimiter {
  private readonly startedAt: number[] = [];

  constructor(
    private readonly maxPerDay: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a session if the limit allows it. */
  tryAcquire(): boolean {
    const now = this.now();
    while (this.startedAt.length > 0 && now - this.startedAt[0]! >= DAY_MS) this.startedAt.shift();
    if (this.startedAt.length >= this.maxPerDay) return false;
    this.startedAt.push(now);
    return true;
  }
}

/** Remembers recently handled webhook ids so retries are not processed twice. */
export class RecentIds {
  private readonly ids = new Map<string, number>();

  constructor(
    private readonly ttlMs: number = DAY_MS,
    private readonly now: () => number = Date.now,
  ) {}

  has(id: string): boolean {
    this.prune();
    return this.ids.has(id);
  }

  add(id: string): void {
    this.prune();
    this.ids.set(id, this.now());
  }

  private prune(): void {
    const now = this.now();
    for (const [id, addedAt] of this.ids) {
      if (now - addedAt < this.ttlMs) break;
      this.ids.delete(id);
    }
  }
}
