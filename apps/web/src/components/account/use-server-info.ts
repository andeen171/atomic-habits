import { syncController } from "@/lib/sync";
import { type ServerInfo, normalizeServerUrl } from "@atomic/core";
import { useEffect, useState } from "react";

export type ServerInfoState =
	| { status: "idle"; info: null }
	| { status: "loading"; info: ServerInfo | null }
	| { status: "ready"; info: ServerInfo }
	| { status: "error"; info: null };

/** Dot-separated labels of letters, digits and hyphens (IPv4 too; IDNs arrive punycoded). */
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;

/**
 * A usable server address ("https://…" added when missing), or null: an
 * http(s) URL whose host is a domain, an IP address or `localhost`. Spaces
 * and stray characters are refused here, since browsers would quietly
 * percent-encode them into a host that can never answer.
 */
export function validServerUrl(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed || /\s/.test(trimmed)) return null;
	try {
		const normalized = normalizeServerUrl(trimmed);
		const url = new URL(normalized);
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		const host = url.hostname;
		if (host.startsWith("[") && host.endsWith("]")) return normalized;
		if (!HOST.test(host)) return null;
		if (!host.includes(".") && host !== "localhost") return null;
		return normalized;
	} catch {
		return null;
	}
}

/**
 * The capabilities of the server a sign-in would use (`GET /trpc/meta`,
 * cached for an hour by the controller): which buttons to offer (Google,
 * "Forgot password?"). Waits `debounceMs` after the address changes.
 */
export function useServerInfo(url: string | null, debounceMs = 400): ServerInfoState {
	const [state, setState] = useState<ServerInfoState>({ status: "idle", info: null });
	useEffect(() => {
		if (!url) {
			setState({ status: "idle", info: null });
			return;
		}
		let live = true;
		setState((prev) => ({ status: "loading", info: prev.info }));
		const timer = window.setTimeout(() => {
			syncController
				.loadServerInfo(url)
				.then((info) => {
					if (live) setState({ status: "ready", info });
				})
				.catch(() => {
					if (live) setState({ status: "error", info: null });
				});
		}, debounceMs);
		return () => {
			live = false;
			window.clearTimeout(timer);
		};
	}, [url, debounceMs]);
	return state;
}
