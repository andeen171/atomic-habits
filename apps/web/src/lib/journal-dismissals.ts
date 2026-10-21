import {
	type DayKey,
	type JournalDismissals,
	dismissJournalKey,
	pruneJournalDismissals,
	toDayKey,
} from "@atomic/core";
import { useMemo } from "react";
import { create } from "zustand";

/**
 * This device's "Not now" answers to journal prompts (Annex J §1.5): the
 * Today nudge keys and the habit page's `checkin:<habitId>:<YYYY-MM>`. Kept
 * in localStorage (`atomic-habits:journal-dismissed`, never synced), pruned
 * after 120 days by core's `pruneJournalDismissals`. Blocked storage falls
 * back to memory for the session. Owner: T3.
 */

const KEY = "atomic-habits:journal-dismissed";

function load(): Record<string, DayKey> {
	try {
		const raw = localStorage.getItem(KEY);
		return pruneJournalDismissals(raw ? JSON.parse(raw) : null, toDayKey());
	} catch {
		return {};
	}
}

function save(map: JournalDismissals): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(map));
	} catch {
		// Memory only.
	}
}

interface DismissalState {
	map: JournalDismissals;
	dismiss(key: string): void;
	restore(key: string): void;
}

const useDismissalStore = create<DismissalState>()((set, get) => ({
	map: typeof window === "undefined" ? {} : load(),
	dismiss(key) {
		const map = dismissJournalKey(get().map, key, toDayKey());
		save(map);
		set({ map });
	},
	restore(key) {
		const { [key]: _removed, ...rest } = pruneJournalDismissals(get().map, toDayKey());
		save(rest);
		set({ map: rest });
	},
}));

if (typeof window !== "undefined") {
	// Another tab said "Not now": follow it.
	window.addEventListener("storage", (event) => {
		if (event.key === KEY) useDismissalStore.setState({ map: load() });
	});
}

/** The dismissed keys, plus `dismiss` ("Not now") and `restore` (its Undo). */
export function useJournalDismissals(): {
	dismissed: ReadonlySet<string>;
	dismiss(key: string): void;
	restore(key: string): void;
} {
	const map = useDismissalStore((s) => s.map);
	const dismiss = useDismissalStore((s) => s.dismiss);
	const restore = useDismissalStore((s) => s.restore);
	const dismissed = useMemo(() => new Set(Object.keys(map)), [map]);
	return { dismissed, dismiss, restore };
}
