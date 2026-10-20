import { addDays, isDayKey } from "@atomic/core";
import { useToday } from "@atomic/core/react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useUI } from "./ui";
import { isTypingTarget } from "./utils";

const CHORD_MS = 1_200;
/** Dialogs, menus and popovers that are open (closing ones keep data-state="closed"). */
const OPEN_LAYER = ["dialog", "alertdialog", "menu"]
	.map((role) => `[role="${role}"]:not([data-state="closed"])`)
	.join(", ");

/** Global keyboard shortcuts from the spec (§6). */
export function useGlobalShortcuts(): void {
	const navigate = useNavigate();
	const router = useRouter();
	const today = useToday();
	const pendingG = useRef<number>(0);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const ui = useUI.getState();
			if (router.state.location.pathname === "/onboarding") return;
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				ui.setPaletteOpen(!ui.paletteOpen);
				return;
			}
			if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
			if (isTypingTarget(event.target)) return;
			// Leave keys alone while a dialog, menu or popover is open.
			if (document.querySelector(OPEN_LAYER)) return;

			const key = event.key;
			const pathname = router.state.location.pathname;
			const search = router.state.location.search as { day?: unknown };
			/** The day Today is showing (a past day from ?day=, else today). */
			const viewed = isDayKey(search.day) && search.day < today ? search.day : today;

			if (pendingG.current && Date.now() - pendingG.current < CHORD_MS) {
				pendingG.current = 0;
				const lower = key.toLowerCase();
				if (lower === "t") void navigate({ to: "/" });
				else if (lower === "h") void navigate({ to: "/habits" });
				else if (lower === "k") void navigate({ to: "/tasks" });
				else if (lower === "j") void navigate({ to: "/journal" });
				else return;
				event.preventDefault();
				return;
			}

			switch (key) {
				case "g":
				case "G":
					pendingG.current = Date.now();
					return;
				case "n":
				case "N":
					event.preventDefault();
					// Same day as Today's inline "Add a task for …" field.
					ui.openTaskDialog({ mode: "create", date: pathname === "/" ? viewed : null });
					return;
				case "h":
				case "H":
					event.preventDefault();
					void navigate({ to: "/habits/new" });
					return;
				case "j":
				case "J":
					// New journal entry: the kind picker.
					event.preventDefault();
					void navigate({ to: "/journal/new" });
					return;
				case "?":
					event.preventDefault();
					ui.setShortcutsOpen(true);
					return;
				case "ArrowLeft":
				case "ArrowRight": {
					if (pathname !== "/") return;
					const next = addDays(viewed, key === "ArrowLeft" ? -1 : 1);
					if (next > today) return;
					event.preventDefault();
					void navigate({ to: "/", search: next === today ? {} : { day: next } });
					return;
				}
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [navigate, router, today]);
}
