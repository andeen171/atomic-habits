/**
 * Offline support for the hosted PWA build. The single-file artifact has no
 * service worker, and custom-protocol webviews (Tauri) don't need one.
 */
export function registerServiceWorker(): void {
	if (!import.meta.env.PROD || import.meta.env.MODE === "artifact") return;
	if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) return;
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {
			// Offline caching is a progressive enhancement; the app works without it.
		});
	});
}
