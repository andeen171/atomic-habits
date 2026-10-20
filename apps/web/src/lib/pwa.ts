import { createTranslator, resolveLocale } from "@atomic/core";
import { toast } from "sonner";
import { store } from "./store";

/** How often an open tab asks the server for a newer service worker. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;
const UPDATE_TOAST_ID = "app-update";

let announced = false;

/**
 * "A new version is ready · Reload" (spec §2.6.5), so stale tabs don't
 * linger on old code. Shown once per page; it stays until acted on.
 */
function announceUpdate(): void {
	if (announced) return;
	announced = true;
	const { settings } = store.getState();
	const i18n = createTranslator(resolveLocale(settings.locale, navigator.languages ?? []));
	toast(i18n.t("app.newVersion"), {
		id: UPDATE_TOAST_ID,
		duration: Number.POSITIVE_INFINITY,
		action: { label: i18n.t("app.reload"), onClick: () => window.location.reload() },
	});
}

/**
 * Offline support for the hosted PWA build. The single-file artifact has no
 * service worker, and custom-protocol webviews (Tauri) don't need one.
 *
 * The worker activates new versions on its own (`registerType: "autoUpdate"`),
 * so an open tab learns about one through `controllerchange` (or an
 * installed worker while this page is controlled) and offers a reload.
 */
export function registerServiceWorker(): void {
	if (!import.meta.env.PROD || import.meta.env.MODE === "artifact") return;
	if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;
	const container = navigator.serviceWorker;
	// A page loaded without a controller is a first install: nothing to announce.
	const controlled = () => container.controller !== null;
	let wasControlled = controlled();

	container.addEventListener("controllerchange", () => {
		if (wasControlled) announceUpdate();
		wasControlled = true;
	});

	window.addEventListener("load", () => {
		container
			.register("./sw.js", { scope: "./" })
			.then((registration) => {
				const watch = (worker: ServiceWorker | null) => {
					worker?.addEventListener("statechange", () => {
						if (worker.state === "installed" && controlled()) announceUpdate();
					});
				};
				if (registration.waiting && controlled()) announceUpdate();
				watch(registration.installing);
				registration.addEventListener("updatefound", () => watch(registration.installing));

				let lastCheck = Date.now();
				const check = () => {
					if (Date.now() - lastCheck < UPDATE_CHECK_MS) return;
					lastCheck = Date.now();
					registration.update().catch(() => {
						// offline: try again later
					});
				};
				document.addEventListener("visibilitychange", () => {
					if (document.visibilityState === "visible") check();
				});
				setInterval(check, UPDATE_CHECK_MS);
			})
			.catch(() => {
				// Offline caching is a progressive enhancement; the app works without it.
			});
	});
}
