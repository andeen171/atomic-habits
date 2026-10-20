/**
 * In-memory fixed-window rate limits for the app's own routes (meta per IP,
 * push per user, …). Better Auth keeps its own limits for `/api/auth/*`.
 *
 * In memory on purpose: the server runs as ONE instance per database (spec
 * §4.5, D47). A second instance would get its own counters (and its own AI
 * semaphore and global caps); scaling out needs a shared limiter first.
 */

export type RateLimitResult = { ok: true } | { ok: false; retryAt: number };

export interface RateLimiter {
	/** Counts one hit for `key` in `scope`; refuses once `max` hits fell in the current window. */
	hit(scope: string, key: string, max: number, windowMs: number): RateLimitResult;
	/** Forget every counter (tests). */
	reset(): void;
}

interface Window {
	start: number;
	count: number;
	windowMs: number;
}

/** Sweep expired windows once the table grows past this many keys. */
const SWEEP_AT = 10_000;

export function createRateLimiter(
	now: () => number = Date.now,
	/** Told about every refusal (metrics: `atomic_rate_limited_total{scope}`); scopes are fixed names. */
	onLimited?: (scope: string) => void,
): RateLimiter {
	const windows = new Map<string, Window>();

	const sweep = (at: number) => {
		for (const [key, window] of windows) {
			if (at - window.start >= window.windowMs) windows.delete(key);
		}
	};

	return {
		hit(scope, key, max, windowMs) {
			const at = now();
			const id = `${scope}\u0000${key}`;
			let window = windows.get(id);
			if (!window || at - window.start >= windowMs) {
				if (!window && windows.size >= SWEEP_AT) sweep(at);
				window = { start: at, count: 0, windowMs };
				windows.set(id, window);
			}
			if (window.count >= max) {
				onLimited?.(scope);
				return { ok: false, retryAt: window.start + windowMs };
			}
			window.count++;
			return { ok: true };
		},
		reset() {
			windows.clear();
		},
	};
}

/** Seconds for a `Retry-After` header (at least 1). */
export function retryAfterSeconds(retryAt: number, now: number): number {
	return Math.max(1, Math.ceil((retryAt - now) / 1000));
}
