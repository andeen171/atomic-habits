/// <reference types="vite/client" />

/** App version from package.json (injected by vite.config.ts). */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
	/** Optional default sync server URL for development. */
	readonly VITE_SERVER_URL?: string;
}
