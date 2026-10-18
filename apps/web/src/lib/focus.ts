import { useRef } from "react";
import { announce } from "./announce";

/**
 * Focus management for overlays and route changes.
 *
 * Every dialog here is a controlled Radix root without a `Trigger`, so Radix
 * has nothing to return focus to and drops it on <body>. We remember what
 * the user was on when a dialog opened and put focus back there on close.
 */

/** Overlays whose items are not useful return targets (they close themselves). */
const TRANSIENT = '[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';
const OVERLAY = `${TRANSIENT}, [role="dialog"], [role="alertdialog"]`;
const CLOSING = '[role="dialog"][data-state="closed"], [role="alertdialog"][data-state="closed"]';
const OPEN = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

let lastFocused: HTMLElement | null = null;
let navigations = 0;

if (typeof document !== "undefined") {
	document.addEventListener(
		"focusin",
		(event) => {
			const el = event.target;
			if (el instanceof HTMLElement && !el.closest(OVERLAY)) lastFocused = el;
		},
		true,
	);
}

/** Called by the router on every pathname change. */
export function noteNavigation(): void {
	navigations++;
}

/** Focus is nowhere useful: on <body>, detached, or inside a dialog that is closing. */
function lost(active: Element | null): boolean {
	return !active || active === document.body || !active.isConnected || !!active.closest(CLOSING);
}

/** The element focus should come back to when an overlay opening now closes. */
function returnTarget(): HTMLElement | null {
	const active = document.activeElement;
	if (!active || active === document.body || !(active instanceof HTMLElement)) return null;
	// Opened from a menu item: return to the button that opened the menu.
	const menu = active.closest('[role="menu"]');
	const triggerId = menu?.getAttribute("aria-labelledby");
	const trigger = triggerId ? document.getElementById(triggerId) : null;
	if (trigger) return trigger;
	// Opened from another transient overlay or from a dialog that is itself
	// closing: use what was focused before that overlay.
	if (active.closest(`${TRANSIENT}, ${CLOSING}`)) {
		return lastFocused?.isConnected ? lastFocused : null;
	}
	return active;
}

interface AutoFocusHandlers {
	onOpenAutoFocus(event: Event): void;
	onCloseAutoFocus(event: Event): void;
}

/** Handlers for a Radix Dialog.Content that restore focus to the opener. */
export function useReturnFocus(handlers: Partial<AutoFocusHandlers> = {}): AutoFocusHandlers {
	const target = useRef<HTMLElement | null>(null);
	const openedAt = useRef(0);
	return {
		onOpenAutoFocus(event) {
			target.current = returnTarget();
			openedAt.current = navigations;
			handlers.onOpenAutoFocus?.(event);
		},
		onCloseAutoFocus(event) {
			handlers.onCloseAutoFocus?.(event);
			if (event.defaultPrevented) return;
			event.preventDefault();
			const el = target.current;
			target.current = null;
			// The route changed while open: focus belongs to the new page.
			if (openedAt.current !== navigations) {
				if (lost(document.activeElement)) focusPage();
				return;
			}
			// Another dialog took over (e.g. the palette opened the task dialog).
			const active = document.activeElement;
			if (active?.closest(OPEN)) return;
			if (el?.isConnected) el.focus();
			else if (lost(active)) document.getElementById("main")?.focus({ preventScroll: true });
		},
	};
}

/**
 * Move focus to the first heading inside `container` when focus was lost
 * (e.g. the focused button was part of the content that just changed). When
 * focus is still somewhere useful, announce the heading instead.
 */
export function focusHeading(
	container: ParentNode | null,
	options: { announceOtherwise?: boolean } = {},
): void {
	const heading = container?.querySelector<HTMLElement>("h1, h2");
	if (!heading) return;
	if (lost(document.activeElement)) {
		if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
		heading.focus({ preventScroll: true });
	} else if (options.announceOtherwise && heading.textContent) {
		announce(heading.textContent);
	}
}

/**
 * After a route change: focus the page's main heading if focus was lost with
 * the old page; otherwise (e.g. focus stayed on a sidebar link) optionally
 * announce the new page's heading.
 */
export function focusPage(options: { announceOtherwise?: boolean } = {}): void {
	const main = document.getElementById("main");
	if (main?.querySelector("h1, h2")) focusHeading(main, options);
	else focusHeading(document, options);
}
