/**
 * The timer's bell (Annex K §1.8.4, §4.2): a soft singing-bowl tone made
 * of two sine partials with a slow decay, about 1.2 s. WebAudio only, no
 * audio file. Browsers start audio only after a user gesture, so the timer
 * calls `primeBell()` from its Start button. Owner: T4.
 */

type AudioContextCtor = typeof AudioContext;

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
	if (context) return context;
	const Ctor =
		typeof window === "undefined"
			? undefined
			: ((window.AudioContext ??
					(window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext) as
					| AudioContextCtor
					| undefined);
	if (!Ctor) return null;
	try {
		context = new Ctor();
	} catch {
		return null;
	}
	return context;
}

/** Unlocks audio while handling a user gesture (Start), so the bell can ring later. */
export function primeBell(): void {
	const ctx = audioContext();
	if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
}

/** Rings the bell once. Silently does nothing where audio isn't available. */
export function playBell(): void {
	const ctx = audioContext();
	if (!ctx) return;
	if (ctx.state === "suspended") void ctx.resume().catch(() => {});
	const now = ctx.currentTime;
	const out = ctx.createGain();
	out.gain.setValueAtTime(0.0001, now);
	out.gain.exponentialRampToValueAtTime(0.32, now + 0.015);
	out.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);
	out.connect(ctx.destination);
	// A fundamental and a slightly inharmonic overtone: a bowl, not a beep.
	for (const [frequency, level] of [
		[528, 1],
		[1358, 0.35],
	] as const) {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = "sine";
		osc.frequency.setValueAtTime(frequency, now);
		gain.gain.setValueAtTime(level, now);
		osc.connect(gain);
		gain.connect(out);
		osc.start(now);
		osc.stop(now + 1.3);
	}
}
