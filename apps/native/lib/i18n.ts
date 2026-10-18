import type { MessageKey, Params, Translator } from "@atomic/core";
import { useI18n } from "@atomic/core/react";
import { useMemo } from "react";
import type { AppMessageKey } from "./messages";

export interface AppTranslator extends Translator {
	/** App-only strings from `lib/messages.ts` (merged into the catalog by AtomicProvider). */
	x(key: AppMessageKey, params?: Params): string;
}

export function useT(): AppTranslator {
	const t = useI18n();
	return useMemo(
		() => ({ ...t, x: (key: AppMessageKey, params?: Params) => t.t(key as MessageKey, params) }),
		[t],
	);
}
