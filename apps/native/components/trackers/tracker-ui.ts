import { ui } from "@/lib/ui-store";
import type { AttachmentRef, DayKey, FormValues, TrackerType } from "@atomic/core";
import { create } from "zustand";

/**
 * Tracker sheets opened from menus and cards (Annex K §5.1): the menu rows
 * live in a sheet that closes first, so the sheets they open are mounted
 * once next to the entry composer (`TrackerSheetsHost`). Owner: T4.
 */
export interface TrackerSettingsTarget {
	habitId: string;
	/** Preselect this tracker (the suggestion card's "Try it", or attaching one). */
	type?: TrackerType;
}

/** Values the next composer for this habit starts with ("Log a connection with Grandma"). */
export interface ComposerPrefill {
	habitId: string;
	values: FormValues;
}

/** One photo in the viewer, with what it belongs to. */
export interface ViewerPhoto {
	ref: AttachmentRef;
	/** The entry's day ("" for a photo not saved yet). */
	day: DayKey | "";
	caption: string | null;
	/** The entry it is part of ("Edit entry"); null for a photo not saved yet. */
	entryId: string | null;
}

/** The photo viewer (`PhotoViewer`): a timeline of photos, or a then-and-now pair. */
export type PhotoViewerState =
	| { mode: "photos"; habitId: string | null; photos: ViewerPhoto[]; index: number }
	| { mode: "compare"; habitId: string | null; before: ViewerPhoto; after: ViewerPhoto };

interface TrackerUIState {
	settings: TrackerSettingsTarget | null;
	/** "Switch to simple check-off" confirmation for this habit. */
	switchToSimple: string | null;
	/** Read by the next entry composer that opens for this habit, then cleared. */
	prefill: ComposerPrefill | null;
	viewer: PhotoViewerState | null;
}

export const useTrackerUI = create<TrackerUIState>(() => ({
	settings: null,
	switchToSimple: null,
	prefill: null,
	viewer: null,
}));

export const trackerUI = {
	openSettings: (settings: TrackerSettingsTarget) => useTrackerUI.setState({ settings }),
	closeSettings: () => useTrackerUI.setState({ settings: null }),
	confirmSwitchToSimple: (habitId: string | null) =>
		useTrackerUI.setState({ switchToSimple: habitId }),
	openViewer: (viewer: PhotoViewerState) => useTrackerUI.setState({ viewer }),
	closeViewer: () => useTrackerUI.setState({ viewer: null }),
	/** Drops a prefill once the composer it was meant for has opened (or another one did). */
	clearPrefill: () => {
		if (useTrackerUI.getState().prefill) useTrackerUI.setState({ prefill: null });
	},
};

/**
 * Opens the entry composer for a habit's day with some fields already filled
 * in (a circle member's name): the nudge becomes the action.
 */
export function openComposerWith(habitId: string, day: DayKey, values: FormValues): void {
	useTrackerUI.setState({ prefill: { habitId, values } });
	ui.openEntryComposer({ habitId, day });
}
