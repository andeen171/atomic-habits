import { AtomicProvider } from "@atomic/core/react";
import {
	RouterProvider,
	createHashHistory,
	createMemoryHistory,
	createRouter,
} from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "./components/ui/tooltip";
import { connectArtifactCloud } from "./lib/artifact-cloud";
import { appMessages } from "./lib/messages";
import { registerServiceWorker } from "./lib/pwa";
import { isArtifactBuild } from "./lib/runtime";
import { store } from "./lib/store";
import { syncController } from "./lib/sync";
import { ThemeProvider } from "./lib/theme";
import { routeTree } from "./routeTree.gen";
import "./styles/index.css";

const router = createRouter({
	routeTree,
	// Hash history works in Tauri and static hosting; the Artifact viewer keeps
	// navigation inside the page, so that build routes in memory.
	history: isArtifactBuild ? createMemoryHistory({ initialEntries: ["/"] }) : createHashHistory(),
	scrollRestoration: true,
	defaultPreload: false,
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

const deviceLocales = typeof navigator !== "undefined" ? [...navigator.languages] : [];

void syncController.start();
registerServiceWorker();
if (isArtifactBuild) void connectArtifactCloud(store);

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app root element");

createRoot(root).render(
	<StrictMode>
		<AtomicProvider store={store} deviceLocales={deviceLocales} messages={appMessages}>
			<ThemeProvider>
				<MotionConfig reducedMotion="user">
					<TooltipProvider delayDuration={300} skipDelayDuration={200}>
						<RouterProvider router={router} />
					</TooltipProvider>
				</MotionConfig>
			</ThemeProvider>
		</AtomicProvider>
	</StrictMode>,
);
