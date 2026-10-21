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
	/** Keys held across all scopes (tests). */
	size(): number;
	/** Forget every counter (tests). */
	reset(): void;
}

interface Window {
	start: number;
	count: number;
	windowMs: number;
}

/**
 * Most keys one scope keeps. Past it the oldest windows are dropped, which
 * only ever lets a dropped key start a fresh window early. Per scope, so a
 * flood of new addresses on a per-IP scope (`pages`, `meta`) never drops
 * the counters of another scope (`email.recipient`, per-user limits).
 */
export const MAX_KEYS_PER_SCOPE = 100_000;

/** Expired windows dropped per new window (amortized: each is dropped once). */
const PRUNE_PER_HIT = 8;

/**
 * Each scope's windows are kept in start order (a renewed window is moved to
 * the end), so expired ones collect at the front: every new window drops a
 * few of them, and the cap drops the oldest. A hit costs O(1) however many
 * keys are live; a full sweep of the table never runs on the request path.
 */
export function createRateLimiter(
	now: () => number = Date.now,
	/** Told about every refusal (metrics: `atomic_rate_limited_total{scope}`); scopes are fixed names. */
	onLimited?: (scope: string) => void,
): RateLimiter {
	const scopes = new Map<string, Map<string, Window>>();

	const prune = (windows: Map<string, Window>, at: number) => {
		let dropped = 0;
		for (const [key, window] of windows) {
			// A scope uses one window length, so the first live window ends the expired run.
			if (dropped >= PRUNE_PER_HIT || at - window.start < window.windowMs) break;
			windows.delete(key);
			dropped++;
		}
		while (windows.size >= MAX_KEYS_PER_SCOPE) {
			const oldest = windows.keys().next();
			if (oldest.done) break;
			windows.delete(oldest.value);
		}
	};

	return {
		hit(scope, key, max, windowMs) {
			const at = now();
			let windows = scopes.get(scope);
			if (!windows) {
				windows = new Map();
				scopes.set(scope, windows);
			}
			let window = windows.get(key);
			if (!window || at - window.start >= windowMs) {
				if (window) windows.delete(key);
				prune(windows, at);
				window = { start: at, count: 0, windowMs };
				windows.set(key, window);
			}
			if (window.count >= max) {
				onLimited?.(scope);
				return { ok: false, retryAt: window.start + windowMs };
			}
			window.count++;
			return { ok: true };
		},
		size() {
			let total = 0;
			for (const windows of scopes.values()) total += windows.size;
			return total;
		},
		reset() {
			scopes.clear();
		},
	};
}

/** Seconds for a `Retry-After` header (at least 1). */
export function retryAfterSeconds(retryAt: number, now: number): number {
	return Math.max(1, Math.ceil((retryAt - now) / 1000));
}
