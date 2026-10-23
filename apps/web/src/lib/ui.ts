import type { DayKey, EntryType, TaskPrefill } from "@atomic/core";
import { create } from "zustand";

/** Ephemeral UI state shared across the shell: global dialogs and sheets. */

/**
 * The task dialog (spec §5.10, Annex T §4.3).
 * - create: `prefill` seeds the form ("Make it a task", setup tasks).
 * - edit: `occurrence` is the series occurrence the row stood for (a row
 *   click passes `item.occurrence`); null or absent means the open one.
 */
export type TaskDialogState =
	| { mode: "create"; date: DayKey | null; prefill?: TaskPrefill }
	| { mode: "edit"; id: string; occurrence?: DayKey | null }
	| null;

export interface NoteDialogState {
	habitId: string;
	date: DayKey;
}

/**
 * The tracker entry composer (Annex K §4.1), mounted once in `__root.tsx`.
 * `entryId` edits an entry; `type` picks the entry type to create (the
 * tracker's default otherwise).
 */
export interface EntryComposerState {
	habitId: string;
	day: DayKey;
	entryId?: string;
	type?: EntryType;
}

interface UIState {
	paletteOpen: boolean;
	shortcutsOpen: boolean;
	createSheetOpen: boolean;
	fourLawsOpen: boolean;
	taskDialog: TaskDialogState;
	noteDialog: NoteDialogState | null;
	entryComposer: EntryComposerState | null;
	setPaletteOpen(open: boolean): void;
	setShortcutsOpen(open: boolean): void;
	setCreateSheetOpen(open: boolean): void;
	setFourLawsOpen(open: boolean): void;
	openTaskDialog(state: TaskDialogState): void;
	openNoteDialog(state: NoteDialogState | null): void;
	openEntryComposer(state: EntryComposerState): void;
	closeEntryComposer(): void;
}

export const useUI = create<UIState>()((set) => ({
	paletteOpen: false,
	shortcutsOpen: false,
	createSheetOpen: false,
	fourLawsOpen: false,
	taskDialog: null,
	noteDialog: null,
	entryComposer: null,
	setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
	setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
	setCreateSheetOpen: (createSheetOpen) => set({ createSheetOpen }),
	setFourLawsOpen: (fourLawsOpen) => set({ fourLawsOpen }),
	openTaskDialog: (taskDialog) => set({ taskDialog }),
	openNoteDialog: (noteDialog) => set({ noteDialog }),
	openEntryComposer: (entryComposer) => set({ entryComposer }),
	closeEntryComposer: () => set({ entryComposer: null }),
}));
