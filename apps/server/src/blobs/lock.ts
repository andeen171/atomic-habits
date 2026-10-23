/**
 * An in-process mutex per key (spec §4.5, D23): the blob GC, uploads and the
 * account purge of one user run one at a time, so GC never deletes a row an
 * upload is about to refresh, and no upload lands while the purge empties
 * the user's storage. Different users never wait for each other.
 *
 * In memory on purpose: the server runs as ONE instance per database
 * (spec §4.5). A second instance would need a shared lock first.
 */
export interface KeyedLock {
	/** Runs `task` once every earlier task for `key` has settled. */
	run<T>(key: string, task: () => Promise<T>): Promise<T>;
	/** Keys with a running or queued task (tests). */
	size(): number;
}

export function createKeyedLock(): KeyedLock {
	/** The settle signal of the last task queued per key; only ever resolves. */
	const tails = new Map<string, Promise<void>>();
	return {
		async run(key, task) {
			const previous = tails.get(key) ?? Promise.resolve();
			let release = () => {};
			const done = new Promise<void>((resolve) => {
				release = resolve;
			});
			const tail = previous.then(() => done);
			tails.set(key, tail);
			await previous;
			try {
				return await task();
			} finally {
				release();
				if (tails.get(key) === tail) tails.delete(key);
			}
		},
		size: () => tails.size,
	};
}
