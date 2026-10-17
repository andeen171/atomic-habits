import type { DayKey } from "@atomic/core";
import { create } from "zustand";

/** Ephemeral UI state shared across the shell: global dialogs and sheets. */

export type TaskDialogState =
	| { mode: "create"; date: DayKey | null }
	| { mode: "edit"; id: string }
	| null;

export interface NoteDialogState {
	habitId: string;
	date: DayKey;
}

interface UIState {
	paletteOpen: boolean;
	shortcutsOpen: boolean;
	createSheetOpen: boolean;
	fourLawsOpen: boolean;
	taskDialog: TaskDialogState;
	noteDialog: NoteDialogState | null;
	setPaletteOpen(open: boolean): void;
	setShortcutsOpen(open: boolean): void;
	setCreateSheetOpen(open: boolean): void;
	setFourLawsOpen(open: boolean): void;
	openTaskDialog(state: TaskDialogState): void;
	openNoteDialog(state: NoteDialogState | null): void;
}

export const useUI = create<UIState>()((set) => ({
	paletteOpen: false,
	shortcutsOpen: false,
	createSheetOpen: false,
	fourLawsOpen: false,
	taskDialog: null,
	noteDialog: null,
	setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
	setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
	setCreateSheetOpen: (createSheetOpen) => set({ createSheetOpen }),
	setFourLawsOpen: (fourLawsOpen) => set({ fourLawsOpen }),
	openTaskDialog: (taskDialog) => set({ taskDialog }),
	openNoteDialog: (noteDialog) => set({ noteDialog }),
}));
