import type { DayKey } from "@atomic/core";
import { useCallback, useSyncExternalStore } from "react";
import { kv } from "./kv";

/**
 * Tiny device-local preferences that don't belong in the synced store (D34).
 * Every read and write is best effort: a failing store falls back to memory
 * for the session.
 */
const CELEBRATED_KEY = "atomic-celebrated-day";

/** `kv` may answer synchronously (web) or throw: always a promise, never a throw. */
async function kvGet(key: string): Promise<string | null> {
	try {
		return (await kv.getItem(key)) ?? null;
	} catch {
		return null;
	}
}

async function kvSet(key: string, value: string | null): Promise<void> {
	try {
		if (value === null) await kv.removeItem(key);
		else await kv.setItem(key, value);
	} catch {
		// Memory only for this session.
	}
}
let celebratedDay: string | null | undefined;

export async function loadCelebratedDay(): Promise<string | null> {
	if (celebratedDay !== undefined) return celebratedDay;
	celebratedDay = await kvGet(CELEBRATED_KEY);
	return celebratedDay;
}

/** Records the celebration; returns false when today was already celebrated. */
export async function claimCelebration(day: string): Promise<boolean> {
	const last = await loadCelebratedDay();
	if (last === day) return false;
	celebratedDay = day;
	await kvSet(CELEBRATED_KEY, day);
	return true;
}

// ── Principle of the day: hidden for one day (spec §5.1, Annex H §1.5) ──

const PRINCIPLE_HIDDEN_KEY = "atomic-habits:principle-hidden";
/** undefined until the stored value has been read. */
let principleHiddenDay: DayKey | null | undefined;
let principleLoad: Promise<DayKey | null> | null = null;
const principleListeners = new Set<() => void>();

function emitPrinciple() {
	for (const listener of principleListeners) listener();
}

/** The day whose principle the user hid, or null. Reads the store once per launch. */
export function loadPrincipleHiddenDay(): Promise<DayKey | null> {
	if (principleHiddenDay !== undefined) return Promise.resolve(principleHiddenDay);
	principleLoad ??= kvGet(PRINCIPLE_HIDDEN_KEY).then((value) => {
		// A choice made while the read was in flight wins.
		if (principleHiddenDay === undefined) {
			principleHiddenDay = value;
			emitPrinciple();
		}
		return principleHiddenDay;
	});
	return principleLoad;
}

/** Hide the principle for `day` (null shows it again). */
export function setPrincipleHiddenDay(day: DayKey | null): void {
	principleHiddenDay = day;
	emitPrinciple();
	void kvSet(PRINCIPLE_HIDDEN_KEY, day);
}

function subscribePrinciple(listener: () => void): () => void {
	principleListeners.add(listener);
	void loadPrincipleHiddenDay();
	return () => {
		principleListeners.delete(listener);
	};
}

const principleSnapshot = () => principleHiddenDay;

/**
 * Whether the principle of `day` is hidden, and a setter. `hidden` is
 * undefined until the stored choice has loaded, so the hero can wait instead
 * of flashing in and collapsing again.
 */
export function usePrincipleHidden(day: DayKey): [boolean | undefined, (hidden: boolean) => void] {
	const hiddenDay = useSyncExternalStore(subscribePrinciple, principleSnapshot, principleSnapshot);
	const setHidden = useCallback(
		(hidden: boolean) => {
			if (hidden) setPrincipleHiddenDay(day);
			else if (principleHiddenDay === day) setPrincipleHiddenDay(null);
		},
		[day],
	);
	return [hiddenDay === undefined ? undefined : hiddenDay === day, setHidden];
}

// ── Month wins: celebrate each `habitId:YYYY-MM` once per device (Annex H §1.1.4) ──

const MONTH_WINS_KEY = "atomic-habits:month-wins";
/** How many celebrated month wins are remembered. */
const MONTH_WINS_KEEP = 100;
let monthWins: string[] | null = null;
/** Claims run one after another, so two quick wins never overwrite each other. */
let monthWinsQueue: Promise<unknown> = Promise.resolve();

async function readMonthWins(): Promise<string[]> {
	if (monthWins) return monthWins;
	try {
		const parsed: unknown = JSON.parse((await kvGet(MONTH_WINS_KEY)) ?? "[]");
		monthWins = Array.isArray(parsed)
			? parsed.filter((key): key is string => typeof key === "string")
			: [];
	} catch {
		monthWins = [];
	}
	return monthWins;
}

/**
 * Claims the celebration for `key` (`habitId:YYYY-MM`): true the first time
 * on this device, false after that. Keeps the last 100 keys.
 */
export function claimMonthWin(key: string): Promise<boolean> {
	const claim = monthWinsQueue.then(async () => {
		const wins = await readMonthWins();
		if (wins.includes(key)) return false;
		monthWins = [...wins, key].slice(-MONTH_WINS_KEEP);
		await kvSet(MONTH_WINS_KEY, JSON.stringify(monthWins));
		return true;
	});
	monthWinsQueue = claim.catch(() => false);
	return claim;
}
