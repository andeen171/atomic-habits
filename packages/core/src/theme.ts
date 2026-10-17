import type { HabitColor } from "./model";

/**
 * Design tokens shared by web (CSS variables) and native (StyleSheet).
 *
 * The look: warm paper and ink, one ember accent for momentum, and a set of
 * habit hues tuned to read well on both light and dark surfaces.
 */

export type ColorScheme = "light" | "dark";

export interface Palette {
	/** App background. */
	bg: string;
	/** Cards, sheets, popovers. */
	surface: string;
	/** Inputs, segmented controls, wells. */
	sunken: string;
	/** Hover / pressed overlay on surfaces. */
	hover: string;
	border: string;
	borderStrong: string;
	text: string;
	textMuted: string;
	textSubtle: string;
	accent: string;
	accentHover: string;
	accentSoft: string;
	onAccent: string;
	success: string;
	successSoft: string;
	warning: string;
	warningSoft: string;
	danger: string;
	dangerSoft: string;
	/** Focus ring. */
	ring: string;
	/** Translucent scrim behind modals. */
	scrim: string;
	/** Empty heatmap cell. */
	heat0: string;
}

export const palettes: Record<ColorScheme, Palette> = {
	light: {
		bg: "#F6F3EE",
		surface: "#FFFFFF",
		sunken: "#EEEAE3",
		hover: "#F1EDE7",
		border: "#E5DFD6",
		borderStrong: "#D3CBBF",
		text: "#1B1814",
		textMuted: "#6A6259",
		textSubtle: "#9B9288",
		accent: "#EE5A2F",
		accentHover: "#DA4C23",
		accentSoft: "#FCE5DC",
		onAccent: "#FFFFFF",
		success: "#2A9D6A",
		successSoft: "#DDF2E8",
		warning: "#D48A0C",
		warningSoft: "#FBEFD5",
		danger: "#D63C3C",
		dangerSoft: "#FADEDE",
		ring: "#EE5A2F",
		scrim: "rgba(27, 24, 20, 0.45)",
		heat0: "#ECE7DF",
	},
	dark: {
		bg: "#0F0E0C",
		surface: "#191715",
		sunken: "#221F1C",
		hover: "#24211E",
		border: "#2B2723",
		borderStrong: "#3B3631",
		text: "#F5F1EA",
		textMuted: "#A79E93",
		textSubtle: "#71695F",
		accent: "#FF6B3D",
		accentHover: "#FF8259",
		accentSoft: "#3A1E14",
		onAccent: "#FFFFFF",
		success: "#3DBE84",
		successSoft: "#14301F",
		warning: "#F2B33D",
		warningSoft: "#3A2C10",
		danger: "#F26060",
		dangerSoft: "#3A1717",
		ring: "#FF6B3D",
		scrim: "rgba(0, 0, 0, 0.6)",
		heat0: "#25221F",
	},
};

/** Base hue per habit color, with a darker variant for text on light surfaces. */
export const habitColors: Record<HabitColor, { base: string; light: string; dark: string }> = {
	ember: { base: "#EE5A2F", light: "#C8431C", dark: "#FF7A50" },
	amber: { base: "#F2A007", light: "#B37400", dark: "#FFC23D" },
	lime: { base: "#7CB518", light: "#5A8A0C", dark: "#A3D94A" },
	emerald: { base: "#16A673", light: "#0E8059", dark: "#3DD69D" },
	teal: { base: "#0FA5A0", light: "#0A7F7B", dark: "#3CD3CC" },
	sky: { base: "#1D9BF0", light: "#1277BD", dark: "#5CB9FF" },
	indigo: { base: "#5B5FEF", light: "#4044C9", dark: "#8A8DFF" },
	violet: { base: "#9255F2", light: "#7238CE", dark: "#B48BFF" },
	rose: { base: "#EC4673", light: "#C42A56", dark: "#FF7A9C" },
	stone: { base: "#8C8279", light: "#665D55", dark: "#B3A99F" },
};

/** Habit color resolved for a scheme: `fill` for rings/fills, `text` for labels, `soft` for tints. */
export function habitColor(color: HabitColor, scheme: ColorScheme) {
	const c = habitColors[color] ?? habitColors.ember;
	return {
		fill: scheme === "dark" ? c.dark : c.base,
		text: scheme === "dark" ? c.dark : c.light,
		soft: withAlpha(scheme === "dark" ? c.dark : c.base, scheme === "dark" ? 0.16 : 0.14),
		softer: withAlpha(scheme === "dark" ? c.dark : c.base, scheme === "dark" ? 0.08 : 0.07),
	};
}

/** #RRGGBB + alpha → #RRGGBBAA (works in CSS and React Native). */
export function withAlpha(hex: string, alpha: number): string {
	const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
		.toString(16)
		.padStart(2, "0");
	return `${hex.slice(0, 7)}${a}`;
}

/** Heatmap fill for an intensity level (0–4) in a habit color. */
export function heatColor(color: HabitColor, level: number, scheme: ColorScheme): string {
	if (level <= 0) return palettes[scheme].heat0;
	const fill = habitColor(color, scheme).fill;
	const alphas = [0, 0.28, 0.48, 0.7, 1];
	return withAlpha(fill, alphas[Math.min(4, level)] ?? 1);
}

export const radii = { xs: 6, sm: 8, md: 12, lg: 16, xl: 22, xxl: 28, full: 999 } as const;
export const spacing = {
	0: 0,
	1: 4,
	2: 8,
	3: 12,
	4: 16,
	5: 20,
	6: 24,
	8: 32,
	10: 40,
	12: 48,
	16: 64,
} as const;

export const fonts = {
	/** Display serif for titles, numbers in heroes and quotes. */
	display: "Instrument Serif",
	/** UI sans for everything else. */
	sans: "Geist",
} as const;

export const typeScale = {
	hero: { size: 44, line: 48 },
	title: { size: 32, line: 36 },
	h2: { size: 22, line: 28 },
	h3: { size: 17, line: 22 },
	body: { size: 15, line: 22 },
	small: { size: 13, line: 18 },
	tiny: { size: 11, line: 14 },
} as const;

export const motion = {
	fast: 140,
	base: 220,
	slow: 420,
	/** Spring used for check animations. */
	spring: { damping: 14, stiffness: 220, mass: 0.8 },
} as const;
