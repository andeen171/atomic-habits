import { readFileSync } from "node:fs";
import { type Palette, motion, palettes, radii, typeScale } from "@atomic/core/theme";
import type { HtmlTagDescriptor, Plugin } from "vite";

/**
 * Design tokens come from `@atomic/core/theme` — the single source of truth
 * shared with the native app. This plugin turns them into CSS custom
 * properties and inlines them in <head>, so the very first paint already has
 * the right colors (no flash before the JS bundle loads).
 */

const kebab = (value: string) => value.replace(/[A-Z0-9]+/g, (m) => `-${m.toLowerCase()}`);

function paletteVars(palette: Palette): string {
	return Object.entries(palette)
		.map(([key, value]) => `--${kebab(key)}:${value};`)
		.join("");
}

function staticVars(): string {
	const radius = Object.entries(radii)
		.map(([key, value]) => `--atomic-radius-${key}:${value}px;`)
		.join("");
	const type = Object.entries(typeScale)
		.map(
			([key, { size, line }]) =>
				`--atomic-text-${key}:${size / 16}rem;--atomic-leading-${key}:${line / 16}rem;`,
		)
		.join("");
	const durations = `--atomic-duration-fast:${motion.fast}ms;--atomic-duration-base:${motion.base}ms;--atomic-duration-slow:${motion.slow}ms;`;
	return radius + type + durations;
}

export function tokensCss(): string {
	return [
		`:root{${staticVars()}${paletteVars(palettes.light)}color-scheme:light;}`,
		`:root.dark{${paletteVars(palettes.dark)}color-scheme:dark;}`,
	].join("");
}

export interface AtomicTokensOptions {
	/** Inline the favicon as a data URI (single-file artifact build). */
	inlineFavicon?: string;
}

export function atomicTokens(options: AtomicTokensOptions = {}): Plugin {
	return {
		name: "atomic-tokens",
		transformIndexHtml: {
			order: "pre",
			handler(html) {
				const tags: HtmlTagDescriptor[] = [
					{
						tag: "style",
						attrs: { id: "atomic-tokens" },
						children: tokensCss(),
						injectTo: "head-prepend",
					},
					{
						tag: "meta",
						attrs: {
							name: "theme-color",
							content: palettes.light.bg,
							media: "(prefers-color-scheme: light)",
						},
						injectTo: "head",
					},
					{
						tag: "meta",
						attrs: {
							name: "theme-color",
							content: palettes.dark.bg,
							media: "(prefers-color-scheme: dark)",
						},
						injectTo: "head",
					},
				];
				if (options.inlineFavicon) {
					const svg = readFileSync(options.inlineFavicon, "utf8");
					const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
					return {
						html: html
							.replace(/<link rel="icon"[^>]*>\s*/g, "")
							.replace(/<link rel="apple-touch-icon"[^>]*>\s*/g, ""),
						tags: [
							...tags,
							{
								tag: "link",
								attrs: { rel: "icon", type: "image/svg+xml", href },
								injectTo: "head",
							},
						],
					};
				}
				return { html, tags };
			},
		},
	};
}
