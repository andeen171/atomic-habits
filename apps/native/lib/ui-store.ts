import type { DayKey } from "@atomic/core";
import { create } from "zustand";

export interface ToastAction {
	label: string;
	onPress: () => void;
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
	/** Quick task composer; `date` is the default day (null = someday). */
	composer: { open: boolean; date: DayKey | null };
	/** Long-press actions for a habit on a given day. */
	habitActions: { habitId: string; day: DayKey } | null;
	/** Bumped to fire the perfect-day confetti. */
	celebration: number;
}

export const useUI = create<UIState>(() => ({
	toasts: [],
	createOpen: false,
	composer: { open: false, date: null },
	habitActions: null,
	celebration: 0,
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
	openComposer: (date: DayKey | null) => useUI.setState({ composer: { open: true, date } }),
	closeComposer: () => useUI.setState((s) => ({ composer: { ...s.composer, open: false } })),
	openHabitActions: (habitId: string, day: DayKey) =>
		useUI.setState({ habitActions: { habitId, day } }),
	closeHabitActions: () => useUI.setState({ habitActions: null }),
	celebrate: () => useUI.setState((s) => ({ celebration: s.celebration + 1 })),
};
