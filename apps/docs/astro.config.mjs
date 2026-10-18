// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
	site: "https://atomic-habits-docs.vercel.app",
	integrations: [
		starlight({
			title: "Atomic",
			description:
				"Tiny habits. Remarkable results. A local-first habit app inspired by Atomic Habits.",
			logo: { src: "./src/assets/logo.svg", alt: "Atomic" },
			favicon: "/favicon.svg",
			customCss: ["./src/styles/theme.css"],
			defaultLocale: "root",
			locales: {
				root: { label: "English", lang: "en" },
				"pt-br": { label: "Português", lang: "pt-BR" },
			},
			social: [
				{
					icon: "github",
					label: "GitHub",
					href: "https://github.com/andeen171/atomic-habits",
				},
			],
			sidebar: [
				{
					label: "Guides",
					translations: { "pt-BR": "Guias" },
					items: [
						{ slug: "guides/getting-started" },
						{ slug: "guides/method" },
						{ slug: "guides/self-hosting" },
					],
				},
				{
					label: "Development",
					translations: { "pt-BR": "Desenvolvimento" },
					autogenerate: { directory: "development" },
				},
				{
					label: "Reference",
					translations: { "pt-BR": "Referência" },
					autogenerate: { directory: "reference" },
				},
			],
		}),
	],
});
