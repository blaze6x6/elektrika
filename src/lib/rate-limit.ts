/**
 * Preprost omejevalnik poskusov (v pomnilniku, za eno instanco aplikacije).
 * Po `max` neuspešnih poskusih v oknu `windowMs` blokira ključ za `lockMs`.
 */
export class RateLimiter {
  private fails = new Map<string, number[]>();
  private locked = new Map<string, number>();

  private max: number;
  private windowMs: number;
  private lockMs: number;

  constructor(max: number, windowMs: number, lockMs: number) {
    this.max = max;
    this.windowMs = windowMs;
    this.lockMs = lockMs;
  }

  check(key: string, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
    const until = this.locked.get(key);
    if (until !== undefined) {
      if (until > now) return { allowed: false, retryAfterSec: Math.ceil((until - now) / 1000) };
      this.locked.delete(key);
      this.fails.delete(key);
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  fail(key: string, now = Date.now()): void {
    const arr = (this.fails.get(key) || []).filter((t) => now - t < this.windowMs);
    arr.push(now);
    this.fails.set(key, arr);
    if (arr.length >= this.max) this.locked.set(key, now + this.lockMs);
    if (this.fails.size > 5000) this.prune(now);
  }

  success(key: string): void {
    this.fails.delete(key);
    this.locked.delete(key);
  }

  private prune(now: number) {
    for (const [k, arr] of this.fails) {
      if (!arr.some((t) => now - t < this.windowMs)) this.fails.delete(k);
    }
    for (const [k, until] of this.locked) if (until <= now) this.locked.delete(k);
  }
}

/** Sekundni "cooldown" za drage operacije (npr. sync na zunanje API-je). */
export class Cooldown {
  private last = new Map<string, number>();
  private ms: number;
  constructor(ms: number) {
    this.ms = ms;
  }
  /** Vrne preostale sekunde, ali 0 če je dovoljeno (in zabeleži zagon). */
  hit(key: string, now = Date.now()): number {
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < this.ms) return Math.ceil((this.ms - (now - prev)) / 1000);
    this.last.set(key, now);
    return 0;
  }
}
