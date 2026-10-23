import { isTauri } from "@/lib/client-info";
import { useColorScheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { ServerInfo } from "@atomic/core";
import { useLocale } from "@atomic/core/react";
import { useEffect, useRef, useState } from "react";

/**
 * "Continue with Google" (Annex C §1.1, §4; D29): Google Identity Services'
 * own button, ID-token flow only. Renders nothing:
 * - in the desktop app (Tauri: its origin can't be registered with Google);
 * - when the server has no Google sign-in, or doesn't list this origin;
 * - while (or when) the GIS script doesn't load (offline, blocked).
 *
 * GIS keeps one global callback, so only the most recently mounted button
 * (the dialog on top) receives the credential. A random nonce per page load
 * is sent with it and checked by the server. Owner: T5.
 */

interface GoogleIdApi {
	initialize(options: {
		client_id: string;
		callback: (response: { credential?: string }) => void;
		nonce?: string;
		use_fedcm_for_prompt?: boolean;
		ux_mode?: "popup";
		auto_select?: boolean;
		itp_support?: boolean;
	}): void;
	renderButton(
		parent: HTMLElement,
		options: {
			theme?: "outline" | "filled_black" | "filled_blue";
			size?: "large" | "medium";
			text?: "continue_with" | "signin_with";
			shape?: "pill" | "rectangular";
			logo_alignment?: "left" | "center";
			locale?: string;
			width?: number;
		},
	): void;
}

declare global {
	interface Window {
		google?: { accounts?: { id?: GoogleIdApi } };
	}
}

const GSI_SRC = "https://accounts.google.com/gsi/client";
let script: Promise<GoogleIdApi> | null = null;

function loadGsi(): Promise<GoogleIdApi> {
	if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
	if (script) return script;
	script = new Promise<GoogleIdApi>((resolve, reject) => {
		const el = document.createElement("script");
		el.src = GSI_SRC;
		el.async = true;
		el.defer = true;
		el.onload = () => {
			const api = window.google?.accounts?.id;
			if (api) resolve(api);
			else reject(new Error("Google Identity Services unavailable"));
		};
		el.onerror = () => reject(new Error("Google Identity Services failed to load"));
		document.head.appendChild(el);
	}).catch((error: unknown) => {
		script = null;
		throw error;
	});
	return script;
}

function randomNonce(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** One nonce for this page load (the server compares it with the token's). */
const NONCE = typeof crypto !== "undefined" ? randomNonce() : undefined;

type CredentialHandler = (idToken: string, nonce: string | undefined) => void;
/** Mounted buttons, newest last: the newest receives the credential. */
const handlers: { current: CredentialHandler }[] = [];
let initializedFor: string | null = null;

function initialize(api: GoogleIdApi, clientId: string): void {
	if (initializedFor === clientId) return;
	initializedFor = clientId;
	api.initialize({
		client_id: clientId,
		nonce: NONCE,
		use_fedcm_for_prompt: true,
		ux_mode: "popup",
		auto_select: false,
		itp_support: true,
		callback: (response) => {
			if (!response.credential) return;
			handlers[handlers.length - 1]?.current(response.credential, NONCE);
		},
	});
}

/** Google sign-in is offered for this server here (not on desktop, origin allowed). */
export function googleAvailable(server: ServerInfo | null | undefined): string | null {
	const google = server?.features.google;
	if (!google || isTauri || typeof window === "undefined") return null;
	if (!google.webOrigins.includes(window.location.origin)) return null;
	return google.webClientId;
}

export function GoogleButton({
	server,
	onCredential,
	disabled,
	className,
}: {
	server: ServerInfo | null | undefined;
	onCredential: CredentialHandler;
	disabled?: boolean;
	className?: string;
}) {
	const clientId = googleAvailable(server);
	const locale = useLocale();
	const scheme = useColorScheme();
	const hostRef = useRef<HTMLDivElement>(null);
	const handler = useRef(onCredential);
	handler.current = onCredential;
	const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

	useEffect(() => {
		const entry = {
			current: (token: string, nonce: string | undefined) => handler.current(token, nonce),
		};
		handlers.push(entry);
		return () => {
			const index = handlers.indexOf(entry);
			if (index >= 0) handlers.splice(index, 1);
		};
	}, []);

	useEffect(() => {
		if (!clientId) return;
		let live = true;
		loadGsi()
			.then((api) => {
				const host = hostRef.current;
				if (!live || !host) return;
				initialize(api, clientId);
				host.replaceChildren();
				api.renderButton(host, {
					theme: scheme === "dark" ? "filled_black" : "outline",
					size: "large",
					text: "continue_with",
					shape: "pill",
					logo_alignment: "center",
					locale,
					width: Math.max(200, Math.min(400, Math.round(host.clientWidth || 320))),
				});
				setState("ready");
			})
			.catch(() => {
				if (live) setState("failed");
			});
		return () => {
			live = false;
		};
	}, [clientId, scheme, locale]);

	if (!clientId || state === "failed") return null;
	return (
		<div
			className={cn(
				"relative min-h-11 w-full",
				disabled && "pointer-events-none opacity-50",
				state === "loading" && "animate-pulse rounded-full bg-sunken",
				className,
			)}
			aria-busy={state === "loading" || undefined}
		>
			<div ref={hostRef} className="flex w-full justify-center [color-scheme:normal]" />
		</div>
	);
}
