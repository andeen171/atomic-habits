import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
	plugins: [
		tailwindcss(),
		TanStackRouterVite({}),
		react(),
		VitePWA({
			registerType: "autoUpdate",
			manifest: {
				name: "atomic-habits",
				short_name: "atomic-habits",
				description: "atomic-habits - PWA Application",
				theme_color: "#0c0c0c",
			},
			pwaAssets: {
				disabled: false,
				config: true,
			},
			devOptions: {
				enabled: true,
			},
		}),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
});
