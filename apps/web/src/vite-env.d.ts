/// <reference types="vite/client" />

/** App version from package.json (injected by vite.config.ts). */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
	/**
	 * The official sync server ("Atomic Cloud", D64), used unless the user picks
	 * another one under "Advanced · self-hosting". Unset (development): the
	 * sign-in dialog asks for a server URL.
	 */
	readonly VITE_SERVER_URL?: string;
	/** QA preview of unfinished tracker flags (see components/trackers/caps.ts). */
	readonly VITE_FEATURES?: string;
}
