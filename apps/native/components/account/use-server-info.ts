import { syncController } from "@/lib/sync";
import type { ServerInfo } from "@atomic/core";
import { useEffect, useState } from "react";

export type ServerInfoState =
	| { status: "idle"; info: null }
	| { status: "loading"; info: null }
	| { status: "ready"; info: ServerInfo }
	| { status: "error"; info: null };

/**
 * The capabilities of the server a sign-in would use (`GET /trpc/meta`,
 * cached for an hour by the controller): which buttons to offer (Google,
 * "Forgot password?"). Waits `debounceMs` after the address changes.
 * Owner: T5.
 */
export function useServerInfo(url: string | null, debounceMs = 400): ServerInfoState {
	const [state, setState] = useState<ServerInfoState>({ status: "idle", info: null });
	useEffect(() => {
		if (!url) {
			setState({ status: "idle", info: null });
			return;
		}
		let live = true;
		// Nothing from the previous address: its Google client is not this server's.
		setState({ status: "loading", info: null });
		const timer = setTimeout(() => {
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
			clearTimeout(timer);
		};
	}, [url, debounceMs]);
	return state;
}
