import confetti from "canvas-confetti";

const CELEBRATED_KEY = "atomic-celebrated-day";

function readCelebrated(): string | null {
	try {
		return localStorage.getItem(CELEBRATED_KEY);
	} catch {
		return memoryCelebrated;
	}
}

let memoryCelebrated: string | null = null;

function writeCelebrated(day: string) {
	memoryCelebrated = day;
	try {
		localStorage.setItem(CELEBRATED_KEY, day);
	} catch {
		// Fall back to memory only.
	}
}

/** Whether today's "perfect day" has already been celebrated on this device. */
export function wasCelebrated(day: string): boolean {
	return readCelebrated() === day;
}

export function markCelebrated(day: string): void {
	writeCelebrated(day);
}

/** A burst of small "atoms" in the colors of the habits that made the day. */
export function fireConfetti(colors: string[]): void {
	const palette = colors.length ? colors : ["#EE5A2F"];
	const defaults = {
		colors: palette,
		shapes: ["circle"] as confetti.Shape[],
		scalar: 0.9,
		ticks: 220,
		gravity: 0.9,
		disableForReducedMotion: true,
		zIndex: 60,
	};
	void confetti({ ...defaults, particleCount: 70, spread: 70, startVelocity: 38, origin: { y: 0.7 } });
	setTimeout(() => {
		void confetti({ ...defaults, particleCount: 40, angle: 60, spread: 55, origin: { x: 0, y: 0.75 } });
		void confetti({ ...defaults, particleCount: 40, angle: 120, spread: 55, origin: { x: 1, y: 0.75 } });
	}, 180);
}
