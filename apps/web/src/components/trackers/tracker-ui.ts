import { useUI } from "@/lib/ui";
import { useIsMobile } from "@/lib/use-media-query";
import type { AttachmentRef, DayKey, FormValues, TrackerType } from "@atomic/core";
import type { ExternalToast } from "sonner";
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

/** Values the next composer for this habit starts with ("Log a connection with Grandma"). */
export interface ComposerPrefill {
	habitId: string;
	values: FormValues;
}

/** One photo in the viewer, with what it belongs to. */
export interface ViewerPhoto {
	ref: AttachmentRef;
	day: DayKey;
	caption: string | null;
	/** The entry it is part of ("Edit entry"); null for a photo not saved yet. */
	entryId: string | null;
}

/** The photo viewer (`PhotoViewer`): a timeline of photos, or a then-and-now pair. */
export type PhotoViewerState =
	| { mode: "photos"; habitId: string | null; photos: ViewerPhoto[]; index: number }
	| { mode: "compare"; habitId: string | null; before: ViewerPhoto; after: ViewerPhoto };

interface TrackerUIState {
	settings: TrackerSettingsState | null;
	prefill: ComposerPrefill | null;
	/** "Switch to simple check-off" confirmation for this habit. */
	switchToSimple: string | null;
	viewer: PhotoViewerState | null;
	openSettings(state: TrackerSettingsState): void;
	closeSettings(): void;
	confirmSwitchToSimple(habitId: string | null): void;
	setPrefill(prefill: ComposerPrefill | null): void;
	openViewer(state: PhotoViewerState): void;
	closeViewer(): void;
}

export const useTrackerUI = create<TrackerUIState>()((set) => ({
	settings: null,
	switchToSimple: null,
	prefill: null,
	viewer: null,
	openSettings: (settings) => set({ settings }),
	closeSettings: () => set({ settings: null }),
	confirmSwitchToSimple: (switchToSimple) => set({ switchToSimple }),
	setPrefill: (prefill) => set({ prefill }),
	openViewer: (viewer) => set({ viewer }),
	closeViewer: () => set({ viewer: null }),
}));

/**
 * Opens the entry composer for a habit's day with some fields already filled
 * in (a circle member's name). The composer takes the values when it mounts.
 */
export function openComposerWith(habitId: string, day: DayKey, values: FormValues): void {
	useTrackerUI.getState().setPrefill({ habitId, values });
	useUI.getState().openEntryComposer({ habitId, day });
}

/**
 * Toast options for a toast shown while a tracker sheet stays open. On phones
 * the composer and the book dialog are bottom sheets, right where toasts sit
 * (above the tab bar), so a toast there would cover their Save buttons for
 * five seconds; those go to the top instead. Desktop keeps the default.
 */
export function useSheetToast(): ExternalToast {
	const mobile = useIsMobile();
	return mobile ? { position: "top-center" } : {};
}
