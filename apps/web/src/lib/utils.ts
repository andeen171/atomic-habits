import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** tailwind-merge that knows the custom scales defined in styles/index.css. */
const twMerge = extendTailwindMerge({
	extend: {
		theme: {
			text: ["hero", "title", "h2", "h3", "body", "small", "tiny"],
			shadow: ["card", "pop"],
			font: ["display", "emoji"],
			ease: ["out-soft"],
			animate: [
				"fade-in",
				"fade-out",
				"pop-in",
				"pop-out",
				"sheet-in",
				"sheet-out",
				"page-in",
				"shake",
			],
		},
	},
});

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

/** True when a keyboard event comes from a text field (shortcuts should not fire). */
export function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export const isMac =
	typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
