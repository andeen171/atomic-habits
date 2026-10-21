import type { TrackerType } from "@atomic/core";
import { create } from "zustand";

/**
 * Tracker dialogs opened from menus (spec §5.3, Annex K §4.1). A menu item
 * unmounts with its menu, so the dialogs it opens live in a host mounted
 * once with the entry composer (`TrackerDialogsHost`). Owner: T4.
 */
export interface TrackerSettingsState {
	habitId: string;
	/** Preselect this tracker (the suggestion card's "Try it", or attaching one). */
	type?: TrackerType;
}

interface TrackerUIState {
	settings: TrackerSettingsState | null;
	/** "Switch to simple check-off" confirmation for this habit. */
	switchToSimple: string | null;
	openSettings(state: TrackerSettingsState): void;
	closeSettings(): void;
	confirmSwitchToSimple(habitId: string | null): void;
}

export const useTrackerUI = create<TrackerUIState>()((set) => ({
	settings: null,
	switchToSimple: null,
	openSettings: (settings) => set({ settings }),
	closeSettings: () => set({ settings: null }),
	confirmSwitchToSimple: (switchToSimple) => set({ switchToSimple }),
}));
