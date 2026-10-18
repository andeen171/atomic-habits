/** Polite screen-reader announcements ("Read 10 pages done"). */
let region: HTMLElement | null = null;

function ensureRegion(): HTMLElement {
	if (region?.isConnected) return region;
	region = document.createElement("div");
	region.setAttribute("aria-live", "polite");
	region.setAttribute("aria-atomic", "true");
	region.className = "sr-only";
	document.body.appendChild(region);
	return region;
}

export function announce(message: string): void {
	const el = ensureRegion();
	el.textContent = "";
	requestAnimationFrame(() => {
		el.textContent = message;
	});
}
