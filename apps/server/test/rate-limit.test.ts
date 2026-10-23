import { describe, expect, test } from "bun:test";
import { MAX_KEYS_PER_SCOPE, createRateLimiter } from "../src/lib/rate-limit";

/**
 * The in-memory limiter (src/lib/rate-limit.ts). Per-IP scopes are reachable
 * without an account, so a client that rotates addresses must not make each
 * hit more expensive, or the table grow without bound.
 */

describe("rate limiter", () => {
	test("counts per scope and key, and opens a new window once the old one ends", () => {
		let t = 1_000_000;
		const limited: string[] = [];
		const limiter = createRateLimiter(
			() => t,
			(scope) => limited.push(scope),
		);
		expect(limiter.hit("a", "k", 2, 60_000)).toEqual({ ok: true });
		expect(limiter.hit("a", "k", 2, 60_000)).toEqual({ ok: true });
		expect(limiter.hit("a", "k", 2, 60_000)).toEqual({ ok: false, retryAt: t + 60_000 });
		expect(limiter.hit("b", "k", 2, 60_000)).toEqual({ ok: true });
		expect(limiter.hit("a", "other", 2, 60_000)).toEqual({ ok: true });
		expect(limited).toEqual(["a"]);
		t += 60_000;
		expect(limiter.hit("a", "k", 2, 60_000)).toEqual({ ok: true });
	});

	test("100k distinct keys keep the cost of a hit flat", () => {
		// Regression: past 10,000 keys every new key swept the whole table, so
		// a client rotating addresses made each request cost O(live keys).
		const t = 1_000_000;
		const limiter = createRateLimiter(() => t);
		/** Mean ms per hit for `count` new keys from `from`. */
		const perHit = (from: number, count: number) => {
			const started = performance.now();
			for (let i = from; i < from + count; i++) limiter.hit("pages", `ip-${i}`, 30, 60_000);
			return (performance.now() - started) / count;
		};
		const early = perHit(0, 5_000);
		perHit(5_000, 90_000);
		const late = perHit(95_000, 5_000);
		expect(limiter.size()).toBe(100_000);
		// Before the fix a late hit took over a millisecond (a full sweep per hit).
		expect(late).toBeLessThan(Math.max(10 * early, 0.05));
	});

	test("expired windows are dropped as new ones arrive", () => {
		let t = 1_000_000;
		const limiter = createRateLimiter(() => t);
		for (let i = 0; i < 1_000; i++) limiter.hit("meta", `ip-${i}`, 60, 60_000);
		t += 60_000;
		for (let i = 0; i < 100; i++) limiter.hit("meta", `new-${i}`, 60, 60_000);
		// Each new window drops up to 8 expired ones (amortized O(1) per hit).
		expect(limiter.size()).toBe(1_000 - 100 * 8 + 100);
		for (let i = 100; i < 200; i++) limiter.hit("meta", `new-${i}`, 60, 60_000);
		expect(limiter.size()).toBe(200);
		// Live windows are kept.
		expect(limiter.hit("meta", "new-0", 1, 60_000).ok).toBe(false);
	});

	test("a scope keeps at most MAX_KEYS_PER_SCOPE keys; a flood never drops another scope's counters", () => {
		const t = 1_000_000;
		const limiter = createRateLimiter(() => t);
		for (let i = 0; i < 3; i++) limiter.hit("email.recipient", "victim@example.com", 3, 3_600_000);
		expect(limiter.hit("email.recipient", "victim@example.com", 3, 3_600_000).ok).toBe(false);
		// Every window is still live: the cap drops the oldest ones.
		limiter.hit("pages", "first", 1, 60_000);
		expect(limiter.hit("pages", "first", 1, 60_000).ok).toBe(false);
		for (let i = 0; i < MAX_KEYS_PER_SCOPE + 500; i++) limiter.hit("pages", `ip-${i}`, 30, 60_000);
		expect(limiter.size()).toBe(MAX_KEYS_PER_SCOPE + 1);
		// The oldest pages window was dropped (a fresh window, never a stricter one)…
		expect(limiter.hit("pages", "first", 1, 60_000).ok).toBe(true);
		// …and the per-recipient email limit still holds.
		expect(limiter.hit("email.recipient", "victim@example.com", 3, 3_600_000).ok).toBe(false);
	});
});
