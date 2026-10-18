import type { HabitColor } from "@atomic/core";
import { useSettings } from "@atomic/core/react";
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
		"--habit-on": readableOn(c.fill, 3),
		"--habit-on-text": readableOn(c.fill, 4.5),
		"--habit-text": c.text,
		"--habit-soft": c.soft,
		"--habit-softer": c.softer,
	};
}

function luminance(hex: string): number {
	const channel = (i: number) => {
		const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * White or warm ink on a habit fill. `minContrast` is 3 for icons (WCAG
 * non-text) and 4.5 for text; white wins whenever it is readable enough.
 */
export function readableOn(hex: string, minContrast = 4.5): string {
	const l = luminance(hex);
	const onWhite = 1.05 / (l + 0.05);
	return onWhite >= minContrast ? "#FFFFFF" : palettes.light.text;
}
