/**
 * Bounded concurrency for model calls (spec §4.5): `slots` calls run at
 * once, at most `queueMax` wait, and a waiter gives up after `waitMs` or
 * when its signal aborts. In memory: one server instance per database (D47).
 */

/** Why a slot wasn't granted. */
export type SemaphoreRefusal = "full" | "waited" | "aborted";

export class SemaphoreError extends Error {
	override readonly name = "SemaphoreError";
	constructor(readonly reason: SemaphoreRefusal) {
		super(reason);
	}
}

interface Waiter {
	grant: () => void;
	cancel: (reason: SemaphoreRefusal) => void;
}

export class Semaphore {
	private active = 0;
	private readonly waiters: Waiter[] = [];

	constructor(
		readonly slots: number,
		readonly queueMax: number,
	) {}

	/** Calls running now. */
	get running(): number {
		return this.active;
	}

	/** Calls waiting for a slot. */
	get queued(): number {
		return this.waiters.length;
	}

	/** Resolves to `release` once a slot is free; rejects with `SemaphoreError`. */
	acquire(signal: AbortSignal, waitMs: number): Promise<() => void> {
		if (signal.aborted) return Promise.reject(new SemaphoreError("aborted"));
		if (this.active < this.slots) {
			this.active++;
			return Promise.resolve(this.releaser());
		}
		if (this.waiters.length >= this.queueMax) {
			return Promise.reject(new SemaphoreError("full"));
		}
		return new Promise((resolve, reject) => {
			const done = () => {
				clearTimeout(timer);
				signal.removeEventListener("abort", onAbort);
				const at = this.waiters.indexOf(waiter);
				if (at >= 0) this.waiters.splice(at, 1);
			};
			const waiter: Waiter = {
				grant: () => {
					done();
					resolve(this.releaser());
				},
				cancel: (reason) => {
					done();
					reject(new SemaphoreError(reason));
				},
			};
			const onAbort = () => waiter.cancel("aborted");
			const timer = setTimeout(() => waiter.cancel("waited"), Math.max(0, waitMs));
			signal.addEventListener("abort", onAbort, { once: true });
			this.waiters.push(waiter);
		});
	}

	private releaser(): () => void {
		let released = false;
		return () => {
			if (released) return;
			released = true;
			const next = this.waiters[0];
			if (next) {
				// The slot passes straight to the next waiter.
				next.grant();
			} else {
				this.active--;
			}
		};
	}
}
