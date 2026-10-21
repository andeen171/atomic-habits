/**
 * `device-storage.ts` for `expo start --web`: localStorage, guarded (private
 * windows and sandboxed frames can refuse it). Owner: T4.
 */
export const deviceStorage = {
	get(key: string): string | null {
		try {
			return globalThis.localStorage?.getItem(key) ?? null;
		} catch {
			return null;
		}
	},
	set(key: string, value: string): boolean {
		try {
			globalThis.localStorage?.setItem(key, value);
			return true;
		} catch {
			return false;
		}
	},
	remove(key: string): void {
		try {
			globalThis.localStorage?.removeItem(key);
		} catch {
			// Nothing to clean up.
		}
	},
	keys(prefix: string): string[] {
		try {
			const storage = globalThis.localStorage;
			if (!storage) return [];
			const out: string[] = [];
			for (let i = 0; i < storage.length; i++) {
				const key = storage.key(i);
				if (key?.startsWith(prefix)) out.push(key);
			}
			return out;
		} catch {
			return [];
		}
	},
};
