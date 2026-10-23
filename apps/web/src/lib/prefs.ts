import type { DayKey } from "@atomic/core";
import { useCallback, useSyncExternalStore } from "react";

/**
 * Device-local preferences for the habits area (D34). Keys are prefixed
 * `atomic-habits:`; every read and write is wrapped, so a private window or
 * blocked storage falls back to memory for the session. Owner: T1.
 */

const PRINCIPLE_HIDDEN_KEY = "atomic-habits:principle-hidden";
const MONTH_WINS_KEY = "atomic-habits:month-wins";
/** How many celebrated month wins are remembered (Annex H §1.1.4). */
const MONTH_WINS_KEEP = 100;

const memory = new Map<string, string | null>();

function read(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return memory.get(key) ?? null;
	}
}

function write(key: string, value: string | null): void {
	memory.set(key, value);
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		// Memory only.
	}
}

// ── Principle of the day: hidden for one day (spec §5.1) ──

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	const onStorage = (event: StorageEvent) => {
		if (event.key === PRINCIPLE_HIDDEN_KEY) listener();
	};
	window.addEventListener("storage", onStorage);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", onStorage);
	};
}

/** The day whose principle the user hid, or null. */
export function loadPrincipleHiddenDay(): DayKey | null {
	return read(PRINCIPLE_HIDDEN_KEY);
}

/** Hide the principle for `day` (null shows it again). */
export function setPrincipleHiddenDay(day: DayKey | null): void {
	write(PRINCIPLE_HIDDEN_KEY, day);
	for (const listener of listeners) listener();
}

/** Whether the principle of `day` is hidden, and a setter; follows other tabs. */
export function usePrincipleHidden(day: DayKey): [boolean, (hidden: boolean) => void] {
	const hiddenDay = useSyncExternalStore(subscribe, loadPrincipleHiddenDay, () => null);
	const setHidden = useCallback(
		(hidden: boolean) => {
			if (hidden) setPrincipleHiddenDay(day);
			else if (loadPrincipleHiddenDay() === day) setPrincipleHiddenDay(null);
		},
		[day],
	);
	return [hiddenDay === day, setHidden];
}

// ── Month wins: celebrate each `habitId:YYYY-MM` once per device ──

function readWins(): string[] {
	try {
		const parsed: unknown = JSON.parse(read(MONTH_WINS_KEY) ?? "[]");
		return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
	} catch {
		return [];
	}
}

/**
 * Claims the celebration for `key` (`habitId:YYYY-MM`). True the first time
 * on this device, false after that. Keeps the last 100 keys.
 */
export function claimMonthWin(key: string): boolean {
	const wins = readWins();
	if (wins.includes(key)) return false;
	write(MONTH_WINS_KEY, JSON.stringify([...wins, key].slice(-MONTH_WINS_KEEP)));
	return true;
}
