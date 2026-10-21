import {
	type DayKey,
	type JournalDismissals,
	dismissJournalKey,
	pruneJournalDismissals,
	toDayKey,
} from "@atomic/core";
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { kv } from "./kv";

/**
 * This device's "Not now" answers to journal prompts (Annex J §1.5, §5):
 * the Today nudge keys and the habit page's `checkin:<habitId>:<YYYY-MM>`.
 * Kept in `kv` under `atomic-habits:journal-dismissed` (never synced) and
 * pruned after 120 days by core's `pruneJournalDismissals`. Read once per
 * launch, asynchronously: until then nothing counts as dismissed, so a
 * dismissed prompt may show for a frame (accepted by the annex). A failing
 * store falls back to memory for the session. Owner: T3.
 */

const KEY = "atomic-habits:journal-dismissed";

interface DismissalState {
	map: JournalDismissals;
}

const useDismissalStore = create<DismissalState>()(() => ({ map: {} }));

let loading: Promise<void> | null = null;

/** Reads the stored map once; answers given before it arrives win over it. */
function hydrate(): Promise<void> {
	if (!loading) {
		loading = (async () => {
			let stored: Record<string, DayKey> = {};
			try {
				const raw = await kv.getItem(KEY);
				stored = pruneJournalDismissals(raw ? JSON.parse(raw) : null, toDayKey());
			} catch {
				// Unreadable or corrupt: start empty.
			}
			useDismissalStore.setState((s) => ({ map: { ...stored, ...s.map } }));
		})();
	}
	return loading;
}

function save(map: JournalDismissals): void {
	void (async () => {
		try {
			await kv.setItem(KEY, JSON.stringify(map));
		} catch {
			// Memory only for this session.
		}
	})();
}

function dismiss(key: string): void {
	const map = dismissJournalKey(useDismissalStore.getState().map, key, toDayKey());
	useDismissalStore.setState({ map });
	// Write after the stored answers are merged in, so none are lost.
	void hydrate().then(() => save(useDismissalStore.getState().map));
}

function restore(key: string): void {
	const { [key]: _removed, ...rest } = pruneJournalDismissals(
		useDismissalStore.getState().map,
		toDayKey(),
	);
	useDismissalStore.setState({ map: rest });
	void hydrate().then(() => {
		const { [key]: _gone, ...after } = useDismissalStore.getState().map;
		useDismissalStore.setState({ map: after });
		save(after);
	});
}

/** The dismissed keys, plus `dismiss` ("Not now") and `restore` (its Undo). */
export function useJournalDismissals(): {
	dismissed: ReadonlySet<string>;
	dismiss(key: string): void;
	restore(key: string): void;
} {
	const map = useDismissalStore((s) => s.map);
	useEffect(() => {
		void hydrate();
	}, []);
	const dismissed = useMemo(() => new Set(Object.keys(map)), [map]);
	return { dismissed, dismiss, restore };
}
