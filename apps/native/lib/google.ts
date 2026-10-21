import { Platform, TurboModuleRegistry } from "react-native";

/**
 * Google sign-in on Android and iOS (Annex C §1.1, §5; D29): the ID-token
 * flow of `@react-native-google-signin/google-signin`, configured with the
 * server's web client ID (`features.google.webClientId`). The server checks
 * the token; nothing else about the Google account is used.
 *
 * The module is optional at runtime: a dev client or build without the
 * native module gets `googleAvailable() === false`, so no Google button
 * shows (requiring the package there would throw). Android needs the APK's
 * SHA-1 on an Android OAuth client of the same Google Cloud project.
 * `google.web.ts` is the `expo start --web` stand-in. Owner: T5.
 */

type GoogleModule = typeof import("@react-native-google-signin/google-signin");

let loaded: GoogleModule | null | undefined;

function load(): GoogleModule | null {
	if (loaded !== undefined) return loaded;
	try {
		loaded = TurboModuleRegistry.get("RNGoogleSignin")
			? (require("@react-native-google-signin/google-signin") as GoogleModule)
			: null;
	} catch {
		loaded = null;
	}
	return loaded;
}

/** True when this build can show "Continue with Google". */
export function googleAvailable(): boolean {
	return load() !== null;
}

/** Why a Google sign-in didn't produce a token (other than the person canceling). */
export class GoogleSignInError extends Error {
	constructor(readonly reason: "play-services" | "unavailable" | "failed") {
		super(`Google sign-in failed: ${reason}`);
	}
}

/**
 * Shows Google's account chooser and resolves to a fresh ID token, or null
 * when the person backs out. Throws `GoogleSignInError` otherwise.
 */
export async function googleIdToken(webClientId: string): Promise<string | null> {
	const google = load();
	if (!google) throw new GoogleSignInError("unavailable");
	const { GoogleSignin, isErrorWithCode, statusCodes } = google;
	try {
		GoogleSignin.configure({ webClientId });
		if (Platform.OS === "android")
			await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
		// Forget the last choice, so the chooser always shows (another account, or a re-auth).
		await GoogleSignin.signOut().catch(() => {});
		const response = await GoogleSignin.signIn();
		if (response.type !== "success") return null;
		const token = response.data.idToken;
		if (!token) throw new GoogleSignInError("failed");
		return token;
	} catch (error) {
		if (error instanceof GoogleSignInError) throw error;
		if (isErrorWithCode(error)) {
			if (error.code === statusCodes.SIGN_IN_CANCELLED || error.code === statusCodes.IN_PROGRESS)
				return null;
			if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE)
				throw new GoogleSignInError("play-services");
		}
		throw new GoogleSignInError("failed");
	}
}
