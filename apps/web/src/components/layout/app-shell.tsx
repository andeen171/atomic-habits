import { useT } from "@/lib/messages";
import { useMonthCelebration } from "@/lib/use-month-celebration";
import type { ReactNode } from "react";
import { CloudBanners } from "../account/cloud-banners";
import { BottomTabs } from "./bottom-tabs";
import { CreateSheet } from "./create-sheet";
import { Sidebar } from "./sidebar";

/** Sidebar / rail on desktop and tablet, bottom tabs on mobile. */
export function AppShell({ children }: { children: ReactNode }) {
	const { at } = useT();
	useMonthCelebration();
	return (
		<div className="min-h-dvh">
			<button
				type="button"
				className="sr-only z-50 rounded-md bg-surface px-4 py-2 text-ink shadow-pop focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
				onClick={() => document.getElementById("main")?.focus()}
			>
				{at("app.skipToContent")}
			</button>
			<Sidebar />
			<main
				id="main"
				tabIndex={-1}
				className="min-h-dvh pb-[calc(var(--tabbar-height)+env(safe-area-inset-bottom)+8px)] outline-none md:pb-0 md:pl-[72px] lg:pl-(--sidebar-width)"
			>
				<CloudBanners />
				{children}
			</main>
			<BottomTabs />
			<CreateSheet />
		</div>
	);
}
