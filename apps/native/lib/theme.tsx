import type { HabitColor } from "@atomic/core";
import { useAtomic } from "@atomic/core/react";
import {
	type ColorScheme,
	type Palette,
	habitColor,
	palettes,
	radii,
	spacing,
	typeScale,
	withAlpha,
} from "@atomic/core/theme";
import { type ReactNode, createContext, useContext, useMemo } from "react";
import { StyleSheet, type ViewStyle, useColorScheme } from "react-native";

/** Font families registered in the root layout (one file per weight). */
export const fonts = {
	regular: "Geist_400Regular",
	italic: "Geist_400Regular_Italic",
	medium: "Geist_500Medium",
	semibold: "Geist_600SemiBold",
	bold: "Geist_700Bold",
	serif: "InstrumentSerif_400Regular",
	serifItalic: "InstrumentSerif_400Regular_Italic",
} as const;

export type HabitTone = ReturnType<typeof habitColor>;

export interface Theme {
	scheme: ColorScheme;
	colors: Palette;
	habit: (color: HabitColor) => HabitTone;
	/** Very soft elevation for cards in light mode; nothing in dark mode. */
	cardShadow: ViewStyle;
	/** Lifted elevation for sheets, toasts and the tab bar. */
	floatShadow: ViewStyle;
	radii: typeof radii;
	space: typeof spacing;
	type: typeof typeScale;
}

function buildTheme(scheme: ColorScheme): Theme {
	const colors = palettes[scheme];
	const ink = palettes.light.text;
	const tones = new Map<HabitColor, HabitTone>();
	return {
		scheme,
		colors,
		habit(color) {
			let tone = tones.get(color);
			if (!tone) {
				tone = habitColor(color, scheme);
				tones.set(color, tone);
			}
			return tone;
		},
		cardShadow:
			scheme === "light"
				? {
						shadowColor: ink,
						shadowOpacity: 0.05,
						shadowRadius: 10,
						shadowOffset: { width: 0, height: 3 },
						elevation: 1,
					}
				: {},
		floatShadow: {
			shadowColor: scheme === "light" ? ink : "#000000",
			shadowOpacity: scheme === "light" ? 0.12 : 0.5,
			shadowRadius: 24,
			shadowOffset: { width: 0, height: 8 },
			elevation: 12,
		},
		radii,
		space: spacing,
		type: typeScale,
	};
}

const themes: Record<ColorScheme, Theme> = { light: buildTheme("light"), dark: buildTheme("dark") };

const ThemeContext = createContext<Theme>(themes.light);

/** Resolves light/dark from `settings.theme` and the system appearance. */
export function ThemeProvider({ children }: { children: ReactNode }) {
	const setting = useAtomic((s) => s.settings.theme);
	const system = useColorScheme();
	const scheme: ColorScheme = setting === "system" ? (system === "dark" ? "dark" : "light") : setting;
	return <ThemeContext.Provider value={themes[scheme]}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
	return useContext(ThemeContext);
}

/** Theme-aware StyleSheet factory, cached per theme. */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(factory: (theme: Theme) => T) {
	const cache = new Map<ColorScheme, T>();
	return function useStyles(): T {
		const theme = useTheme();
		return useMemo(() => {
			let styles = cache.get(theme.scheme);
			if (!styles) {
				styles = StyleSheet.create(factory(theme));
				cache.set(theme.scheme, styles);
			}
			return styles;
		}, [theme]);
	};
}

export { withAlpha };
