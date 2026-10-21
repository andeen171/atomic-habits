/**
 * `google.ts` for the `expo start --web` QA export: no native Google
 * sign-in there (the web app proper uses Google Identity Services), so the
 * button never shows. Owner: T5.
 */

export function googleAvailable(): boolean {
	return false;
}

export class GoogleSignInError extends Error {
	constructor(readonly reason: "play-services" | "unavailable" | "failed") {
		super(`Google sign-in failed: ${reason}`);
	}
}

export async function googleIdToken(_webClientId: string): Promise<string | null> {
	throw new GoogleSignInError("unavailable");
}
