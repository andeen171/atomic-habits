import { useRef } from "react";
import { announce } from "./announce";

/**
 * Focus management for overlays and route changes.
 *
 * Every dialog here is a controlled Radix root without a `Trigger`, so Radix
 * has nothing to return focus to and drops it on <body>. We remember what
 * the user was on when a dialog opened and put focus back there on close.
 *
 * List rows that a dialog can remove (a task deleted from its edit dialog)
 * carry `data-focus-row="<id>"` and turn `inert` while their exit animation
 * plays. When the opener is gone, focus moves to the same item re-rendered
 * elsewhere, else the next row, else the previous one, else #main.
 */

/** Overlays whose items are not useful return targets (they close themselves). */
const TRANSIENT = '[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';
const OVERLAY = `${TRANSIENT}, [role="dialog"], [role="alertdialog"]`;
const CLOSING = '[role="dialog"][data-state="closed"], [role="alertdialog"][data-state="closed"]';
const OPEN = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';
const ROW = "[data-focus-row]";
const FOCUSABLE =
	'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

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

/** Where focus goes back to, captured when an overlay opens. */
interface ReturnPlan {
	target: HTMLElement | null;
	/** Every list row in document order at open time, and the opener's index in it. */
	rows: HTMLElement[];
	index: number;
	/** The opener row's item id, to find the item again if it re-rendered elsewhere. */
	key: string | undefined;
	/** Which of the row's focusable controls the opener was. */
	slot: number;
}

/** In the document and not on its way out (exiting rows are inert). */
function alive(el: HTMLElement | null | undefined): el is HTMLElement {
	return !!el && el.isConnected && !el.closest("[inert]");
}

function focusables(row: HTMLElement): HTMLElement[] {
	return [...row.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

/** Focus the control in `row` matching the opener's position; false if it can't take focus. */
function focusRow(row: HTMLElement | undefined, slot: number): boolean {
	if (!alive(row)) return false;
	const items = focusables(row);
	const el = items[Math.min(slot, items.length - 1)];
	if (!el) return false;
	el.focus();
	return document.activeElement === el;
}

function planFor(target: HTMLElement | null): ReturnPlan {
	const row = target?.closest<HTMLElement>(ROW) ?? null;
	if (!target || !row) return { target, rows: [], index: -1, key: undefined, slot: 0 };
	const rows = [...document.querySelectorAll<HTMLElement>(ROW)];
	return {
		target,
		rows,
		index: rows.indexOf(row),
		key: row.dataset.focusRow,
		slot: Math.max(0, focusables(row).indexOf(target)),
	};
}

/** Put focus back on the opener, or on its nearest surviving neighbour row. */
function restore(plan: ReturnPlan): boolean {
	if (alive(plan.target)) {
		plan.target.focus();
		return true;
	}
	if (plan.index < 0) return false;
	// The same item re-rendered in another place (e.g. a task moved to another day).
	if (plan.key) {
		for (const row of document.querySelectorAll<HTMLElement>(ROW)) {
			if (row.dataset.focusRow === plan.key && focusRow(row, plan.slot)) return true;
		}
	}
	for (let i = plan.index + 1; i < plan.rows.length; i++) {
		if (focusRow(plan.rows[i], plan.slot)) return true;
	}
	for (let i = plan.index - 1; i >= 0; i--) {
		if (focusRow(plan.rows[i], plan.slot)) return true;
	}
	return false;
}

/** Handlers for a Radix Dialog.Content that restore focus to the opener. */
export function useReturnFocus(handlers: Partial<AutoFocusHandlers> = {}): AutoFocusHandlers {
	const plan = useRef<ReturnPlan | null>(null);
	const openedAt = useRef(0);
	return {
		onOpenAutoFocus(event) {
			plan.current = planFor(returnTarget());
			openedAt.current = navigations;
			handlers.onOpenAutoFocus?.(event);
		},
		onCloseAutoFocus(event) {
			handlers.onCloseAutoFocus?.(event);
			if (event.defaultPrevented) return;
			event.preventDefault();
			const saved = plan.current;
			plan.current = null;
			// The route changed while open: focus belongs to the new page.
			if (openedAt.current !== navigations) {
				if (lost(document.activeElement)) focusPage();
				return;
			}
			// Another dialog took over (e.g. the palette opened the task dialog).
			const active = document.activeElement;
			if (active?.closest(OPEN)) return;
			if (saved && restore(saved)) return;
			if (lost(document.activeElement)) {
				document.getElementById("main")?.focus({ preventScroll: true });
			}
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

/**
 * Keep keyboard focus through a change that re-renders or removes the focused
 * control (a task checked off moves to "Done"; "Clear completed" removes its
 * whole section). After the update, focus the same item again, else its
 * nearest neighbour row, else the page heading.
 */
export function keepFocus(from: HTMLElement | null): void {
	const plan = planFor(from);
	requestAnimationFrame(() => {
		const active = document.activeElement;
		if (!lost(active) && !active?.closest("[inert]")) return;
		if (!restore(plan)) focusPage();
	});
}
