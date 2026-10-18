import { readFileSync } from "node:fs";
import path from "node:path";
import { palettes } from "@atomic/core/theme";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { type PluginOption, defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { viteSingleFile } from "vite-plugin-singlefile";
import { atomicTokens } from "./plugins/atomic-tokens";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8")) as {
	version: string;
};

/**
 * Two build targets:
 * - default (`vite build`)            → dist/ with an offline-ready PWA (also used by Tauri)
 * - artifact (`vite build --mode artifact`) → dist-artifact/index.html, one self-contained file
 */
export default defineConfig(({ mode }) => {
	const artifact = mode === "artifact";

	const plugins: PluginOption[] = [
		tanstackRouter({ target: "react", autoCodeSplitting: false }),
		react(),
		tailwindcss(),
		atomicTokens(
			artifact ? { inlineFavicon: path.resolve(__dirname, "public/favicon.svg") } : undefined,
		),
	];

	if (artifact) {
		plugins.push(viteSingleFile({ removeViteModuleLoader: true }));
	} else {
		plugins.push(
			VitePWA({
				registerType: "autoUpdate",
				// Registered from src/lib/pwa.ts so the artifact build and Tauri can skip it.
				injectRegister: false,
				includeAssets: ["favicon.svg", "favicon.ico", "apple-touch-icon-180x180.png"],
				manifest: {
					name: "Atomic",
					short_name: "Atomic",
					description: "Tiny habits. Remarkable results.",
					theme_color: palettes.light.bg,
					background_color: palettes.light.bg,
					display: "standalone",
					start_url: "./",
					scope: "./",
					icons: [
						{ src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
						{ src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
						{ src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
						{
							src: "maskable-icon-512x512.png",
							sizes: "512x512",
							type: "image/png",
							purpose: "maskable",
						},
					],
				},
				workbox: {
					globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
					navigateFallback: "index.html",
				},
			}),
		);
	}

	return {
		base: "./",
		plugins,
		publicDir: artifact ? false : "public",
		define: { __APP_VERSION__: JSON.stringify(pkg.version) },
		resolve: {
			alias: { "@": path.resolve(__dirname, "./src") },
		},
		build: {
			outDir: artifact ? "dist-artifact" : "dist",
			emptyOutDir: true,
			target: "es2022",
			chunkSizeWarningLimit: 1500,
		},
		server: { port: 3001 },
	};
});
