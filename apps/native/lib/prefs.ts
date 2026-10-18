import { kv } from "./kv";

/** Tiny device-local preferences that don't belong in the synced store. */
const CELEBRATED_KEY = "atomic-celebrated-day";
let celebratedDay: string | null | undefined;

export async function loadCelebratedDay(): Promise<string | null> {
	if (celebratedDay !== undefined) return celebratedDay;
	try {
		celebratedDay = (await kv.getItem(CELEBRATED_KEY)) ?? null;
	} catch {
		celebratedDay = null;
	}
	return celebratedDay;
}

/** Records the celebration; returns false when today was already celebrated. */
export async function claimCelebration(day: string): Promise<boolean> {
	const last = await loadCelebratedDay();
	if (last === day) return false;
	celebratedDay = day;
	try {
		await kv.setItem(CELEBRATED_KEY, day);
	} catch {
		// best effort
	}
	return true;
}
