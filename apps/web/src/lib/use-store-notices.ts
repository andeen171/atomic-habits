import { useAtomicStore } from "@atomic/core/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useT } from "./messages";

/**
 * Store notices that are events, not state (spec §2.7): an edit refused
 * because a newer version of Atomic wrote that document shows the toast
 * `sync.superseded`. Persist errors are state (`persistError`) and show the
 * blocking banner in `CloudBanners` instead. Mounted once, in `__root.tsx`.
 */
export function useStoreNotices(): void {
	const store = useAtomicStore();
	const { t } = useT();
	const translate = useRef(t);
	translate.current = t;

	useEffect(
		() =>
			store.subscribeNotices((notice) => {
				if (notice.type !== "superseded") return;
				// One toast however many documents a single action touched.
				toast.warning(translate.current("sync.superseded"), { id: "sync-superseded" });
			}),
		[store],
	);
}
