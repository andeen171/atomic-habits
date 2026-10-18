import { useSettings } from "@atomic/core/react";
import type { HabitColor } from "@atomic/core";
import { type ColorScheme, habitColor, palettes } from "@atomic/core/theme";
import {
	type CSSProperties,
	type ReactNode,
	createContext,
	useContext,
	useLayoutEffect,
	useMemo,
} from "react";
import { useMediaQuery } from "./use-media-query";

/**
 * The resolved color scheme (settings.theme + prefers-color-scheme). CSS uses
 * the `.dark` class on <html>; JS consumers (habit colors, charts) read it
 * from this context.
 */

const THEME_KEY = "atomic-theme";
const ColorSchemeContext = createContext<ColorScheme>("light");

export function ThemeProvider({ children }: { children: ReactNode }) {
	const { theme } = useSettings();
	const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
	const scheme: ColorScheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

	useLayoutEffect(() => {
		const root = document.documentElement;
		root.classList.toggle("dark", scheme === "dark");
		for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
			meta.content = palettes[scheme].bg;
		}
		try {
			// Mirrors the setting for the pre-paint script in index.html.
			localStorage.setItem(THEME_KEY, theme);
		} catch {
			// Storage can be unavailable (private mode, sandboxed iframe).
		}
	}, [scheme, theme]);

	return <ColorSchemeContext.Provider value={scheme}>{children}</ColorSchemeContext.Provider>;
}

export function useColorScheme(): ColorScheme {
	return useContext(ColorSchemeContext);
}

export type HabitStyle = CSSProperties & Record<`--habit${string}`, string>;

/** CSS variables for a habit hue: `--habit`, `--habit-text`, `--habit-soft`, `--habit-softer`. */
export function useHabitStyle(color: HabitColor): HabitStyle {
	const scheme = useColorScheme();
	return useMemo(() => habitStyle(color, scheme), [color, scheme]);
}

export function habitStyle(color: HabitColor, scheme: ColorScheme): HabitStyle {
	const c = habitColor(color, scheme);
	return {
		"--habit": c.fill,
		"--habit-text": c.text,
		"--habit-soft": c.soft,
		"--habit-softer": c.softer,
	};
}
