import {
	type ReactNode,
	createContext,
	createElement,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useStore } from "zustand";
import { type DayKey, toDayKey } from "./dates";
import type { LogIndex } from "./habits";
import { type Locale, type Translator, createTranslator, resolveLocale } from "./i18n";
import { logIndexOf } from "./indexes";
import type { Settings } from "./model";
import type { AtomicActions, AtomicState, AtomicStore } from "./store";

/**
 * The store context and the base hooks every hook module builds on
 * (`react.ts`, `react-*.ts`, `trackers/react.ts`). Exported from `react.ts`
 * (`@atomic/core/react`); hook modules import this file, never `react.ts`, so
 * the module graph has no cycles.
 *
 * Selectors passed to `useAtomic` must return stable references (raw slices
 * of state); derive arrays with memoised hooks, and indexes through
 * `indexes.ts`.
 */

type ExtraMessages = Partial<Record<Locale, Record<string, string>>>;

interface AtomicContextValue {
	store: AtomicStore;
	deviceLocales: readonly string[];
	messages?: ExtraMessages;
}

const AtomicContext = createContext<AtomicContextValue | null>(null);

export interface AtomicProviderProps {
	store: AtomicStore;
	/** Device language tags, e.g. navigator.languages or expo-localization. */
	deviceLocales?: readonly string[];
	/** App-specific strings merged over the shared catalog. */
	messages?: ExtraMessages;
	children?: ReactNode;
}

export function AtomicProvider({ store, deviceLocales, messages, children }: AtomicProviderProps) {
	const value = useMemo(
		() => ({ store, deviceLocales: deviceLocales ?? [], messages }),
		[store, deviceLocales, messages],
	);
	return createElement(AtomicContext.Provider, { value }, children);
}

function useAtomicContext(): AtomicContextValue {
	const ctx = useContext(AtomicContext);
	if (!ctx) throw new Error("Atomic hooks must be used inside <AtomicProvider>");
	return ctx;
}

export function useAtomicStore(): AtomicStore {
	return useAtomicContext().store;
}

export function useAtomic<T>(selector: (state: AtomicState) => T): T {
	return useStore(useAtomicStore(), selector);
}

export function useActions(): AtomicActions {
	return useAtomic((s) => s.actions);
}

export function useSettings(): Settings {
	return useAtomic((s) => s.settings);
}

export function useHydrated(): boolean {
	return useAtomic((s) => s.hydrated);
}

/** Current local day; rolls over at midnight and after the device wakes. */
export function useToday(): DayKey {
	const [today, setToday] = useState(() => toDayKey());
	useEffect(() => {
		const id = setInterval(() => {
			const next = toDayKey();
			setToday((prev) => (prev === next ? prev : next));
		}, 30_000);
		return () => clearInterval(id);
	}, []);
	return today;
}

export function useLocale(): Locale {
	const { deviceLocales } = useAtomicContext();
	const setting = useAtomic((s) => s.settings.locale);
	return resolveLocale(setting, deviceLocales);
}

export function useI18n(): Translator {
	const locale = useLocale();
	const { messages } = useAtomicContext();
	return useMemo(() => createTranslator(locale, messages?.[locale]), [locale, messages]);
}

/** Live habit logs by habit and day; shared across hooks (`indexes.ts`). */
export function useLogIndex(): LogIndex {
	return logIndexOf(useAtomic((s) => s.data.logs));
}
