import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/core/errors.js";
import { canonicalJson, IdempotencyStore } from "../src/core/idempotency.js";

describe("canonicalJson", () => {
  it("is independent of key order and ignores undefined", () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe(canonicalJson({ a: [1, { d: 2 }], b: 1 }));
  });
});

describe("IdempotencyStore", () => {
  it("executes once and replays the result for the same key and payload", async () => {
    const store = new IdempotencyStore();
    const exec = vi.fn(() => Promise.resolve({ id: "x1" }));
    const first = await store.run("create", "key-00001", { a: 1 }, exec);
    const second = await store.run("create", "key-00001", { a: 1 }, exec);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ value: { id: "x1" }, replayed: false });
    expect(second).toEqual({ value: { id: "x1" }, replayed: true });
  });

  it("deduplicates concurrent requests with the same key", async () => {
    const store = new IdempotencyStore();
    const exec = vi.fn(() => new Promise((r) => setTimeout(() => { r("done"); }, 10)));
    const results = await Promise.all([1, 2, 3].map(() => store.run("op", "key-00002", {}, exec)));
    expect(exec).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.replayed)).toHaveLength(2);
  });

  it("rejects reuse of a key with a different payload", async () => {
    const store = new IdempotencyStore();
    await store.run("create", "key-00003", { a: 1 }, () => Promise.resolve(1));
    await expect(store.run("create", "key-00003", { a: 2 }, () => Promise.resolve(2))).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });

  it("evicts failed operations so they can be retried", async () => {
    const store = new IdempotencyStore();
    await expect(
      store.run("op", "key-00004", {}, () => Promise.reject(new AppError("UPSTREAM_UNAVAILABLE", "down"))),
    ).rejects.toBeInstanceOf(AppError);
    const retry = await store.run("op", "key-00004", {}, () => Promise.resolve("ok"));
    expect(retry).toEqual({ value: "ok", replayed: false });
  });

  it("expires entries after the TTL", async () => {
    let now = 0;
    const store = new IdempotencyStore({ ttlMs: 1000, now: () => now });
    const exec = vi.fn(() => Promise.resolve("v"));
    await store.run("op", "key-00005", {}, exec);
    now = 1500;
    const again = await store.run("op", "key-00005", {}, exec);
    expect(again.replayed).toBe(false);
    expect(exec).toHaveBeenCalledTimes(2);
  });
});
