import type { DayKey, EntryType, TaskPrefill } from "@atomic/core";
import { create } from "zustand";

export interface ToastAction {
	label: string;
	onPress: () => void;
}

export type HabitsFilter = "all" | "build" | "break" | "archived";

/** The tracker entry composer (Annex K §5.1): create when `entryId` is absent. */
export interface EntryComposerTarget {
	habitId: string;
	day: DayKey;
	/** Edit this entry. */
	entryId?: string;
	/** Entry type to create (defaults to the tracker's primary type). */
	type?: EntryType;
}

/** A tracker habit's entries on one day (calendar on tracker days, spec §6). */
export interface DayEntriesTarget {
	habitId: string;
	day: DayKey;
}

export interface Toast {
	id: number;
	message: string;
	tone: "default" | "success" | "danger";
	action?: ToastAction;
	duration: number;
}

interface UIState {
	toasts: Toast[];
	/** ⊕ create sheet (New habit / New task). */
	createOpen: boolean;
	/**
	 * Quick task composer; `date` is the default day (null = someday).
	 * `prefill` comes from setup tasks ("Make it a task", Annex T §5.3).
	 */
	composer: { open: boolean; date: DayKey | null; prefill?: TaskPrefill };
	/** Tracker entry composer sheet (global). */
	entryComposer: EntryComposerTarget | null;
	/** Tracker day entries sheet (global). */
	dayEntries: DayEntriesTarget | null;
	/** Long-press actions for a habit on a given day. */
	habitActions: { habitId: string; day: DayKey } | null;
	/** Bumped to fire the perfect-day confetti. */
	celebration: number;
	/** Filter on the Habits tab (other screens can point it at a filter). */
	habitsFilter: HabitsFilter;
	/** Open bottom sheets: all of them, and the ones drawn in the app portal. */
	openSheets: number;
	openPortalSheets: number;
}

export const useUI = create<UIState>(() => ({
	toasts: [],
	createOpen: false,
	composer: { open: false, date: null },
	entryComposer: null,
	dayEntries: null,
	habitActions: null,
	celebration: 0,
	habitsFilter: "all",
	openSheets: 0,
	openPortalSheets: 0,
}));

let toastId = 0;

export function showToast(
	message: string,
	options: { tone?: Toast["tone"]; action?: ToastAction; duration?: number } = {},
): number {
	toastId += 1;
	const toast: Toast = {
		id: toastId,
		message,
		tone: options.tone ?? "default",
		action: options.action,
		duration: options.duration ?? (options.action ? 5000 : 3200),
	};
	// Keep the stack short: the newest message matters most.
	useUI.setState((s) => ({ toasts: [...s.toasts.slice(-1), toast] }));
	return toast.id;
}

export function dismissToast(id: number) {
	useUI.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export const ui = {
	openCreate: () => useUI.setState({ createOpen: true }),
	closeCreate: () => useUI.setState({ createOpen: false }),
	openComposer: (date: DayKey | null, prefill?: TaskPrefill) =>
		useUI.setState({ composer: { open: true, date, prefill } }),
	closeComposer: () => useUI.setState((s) => ({ composer: { ...s.composer, open: false } })),
	openHabitActions: (habitId: string, day: DayKey) =>
		useUI.setState({ habitActions: { habitId, day } }),
	closeHabitActions: () => useUI.setState({ habitActions: null }),
	openEntryComposer: (target: EntryComposerTarget) => useUI.setState({ entryComposer: target }),
	closeEntryComposer: () => useUI.setState({ entryComposer: null }),
	openDayEntries: (habitId: string, day: DayKey) =>
		useUI.setState({ dayEntries: { habitId, day } }),
	closeDayEntries: () => useUI.setState({ dayEntries: null }),
	celebrate: () => useUI.setState((s) => ({ celebration: s.celebration + 1 })),
	showHabitsFilter: (habitsFilter: HabitsFilter) => useUI.setState({ habitsFilter }),
	/** Registers an open sheet; returns the cleanup that unregisters it. */
	trackSheet(inline: boolean): () => void {
		const delta = (d: number) =>
			useUI.setState((s) => ({
				openSheets: s.openSheets + d,
				openPortalSheets: s.openPortalSheets + (inline ? 0 : d),
			}));
		delta(1);
		return () => delta(-1);
	},
};
