import { createHash } from "node:crypto";
import { AppError } from "./errors.js";

/** Stable JSON serialization (sorted keys) so equal payloads hash equally. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function fingerprint(operation: string, payload: unknown): string {
  return createHash("sha256").update(`${operation}\n${canonicalJson(payload)}`).digest("hex");
}

interface Entry {
  fingerprint: string;
  expiresAt: number;
  /** Shared promise so concurrent retries with the same key run the operation once. */
  result: Promise<unknown>;
}

export interface IdempotencyOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

/**
 * In-process idempotency store for create operations.
 *
 * - Same key + same payload  -> the original result is replayed, no duplicate write.
 * - Same key + different payload -> IDEMPOTENCY_KEY_REUSED (caller bug, surfaced loudly).
 * - Failed operations are evicted so they can be retried with the same key.
 *
 * For multi-instance deployments swap this for a Redis/DB-backed store with the
 * same contract.
 */
export class IdempotencyStore {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(opts: IdempotencyOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
    this.maxEntries = opts.maxEntries ?? 10_000;
    this.now = opts.now ?? Date.now;
  }

  async run<T>(
    operation: string,
    key: string,
    payload: unknown,
    execute: () => Promise<T>,
  ): Promise<{ value: T; replayed: boolean }> {
    this.evictExpired();
    const scopedKey = `${operation}:${key}`;
    const fp = fingerprint(operation, payload);
    const existing = this.entries.get(scopedKey);

    if (existing) {
      if (existing.fingerprint !== fp) {
        throw new AppError(
          "IDEMPOTENCY_KEY_REUSED",
          `Idempotency key '${key}' was already used for a different ${operation} request.`,
          { operation, idempotencyKey: key },
        );
      }
      return { value: (await existing.result) as T, replayed: true };
    }

    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }

    const result = execute();
    this.entries.set(scopedKey, { fingerprint: fp, expiresAt: this.now() + this.ttlMs, result });
    try {
      return { value: await result, replayed: false };
    } catch (err) {
      this.entries.delete(scopedKey);
      throw err;
    }
  }

  get size(): number {
    return this.entries.size;
  }

  private evictExpired(): void {
    const now = this.now();
    for (const [k, v] of this.entries) {
      if (v.expiresAt <= now) this.entries.delete(k);
    }
  }
}
