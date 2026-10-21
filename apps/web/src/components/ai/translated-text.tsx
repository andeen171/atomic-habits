import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import type { Collection, MessageKey } from "@atomic/core";
import { useText } from "@atomic/core/react";
import { Languages } from "lucide-react";
import type { ElementType } from "react";
import { create } from "zustand";
import { splitLayoutClasses } from "./class-split";

/** Collections whose text can be shown translated (Annex C §1.8; never the journal). */
export type TranslatableCollection = Extract<
	Collection,
	"habits" | "identities" | "tasks" | "scorecard"
>;

export interface TranslatedTextProps {
	collection: TranslatableCollection;
	/** The document (habit, identity, task or scorecard item). */
	entity: Record<string, unknown>;
	field: string;
	/** The element to render ("h1" for the habit page title). Default "span". */
	as?: ElementType;
	className?: string;
}

const SESSION_KEY = "atomic-habits:show-original";

function loadShown(): Set<string> {
	try {
		const raw = sessionStorage.getItem(SESSION_KEY);
		return new Set(raw ? (JSON.parse(raw) as string[]) : []);
	} catch {
		return new Set();
	}
}

/** Texts the user switched back to the original in this session (per tab). */
const useShowOriginal = create<{ shown: Set<string>; toggle(key: string): void }>((set) => ({
	shown: typeof window === "undefined" ? new Set() : loadShown(),
	toggle: (key) =>
		set((state) => {
			const shown = new Set(state.shown);
			if (shown.has(key)) shown.delete(key);
			else shown.add(key);
			try {
				sessionStorage.setItem(SESSION_KEY, JSON.stringify([...shown]));
			} catch {
				// Private mode: the choice lasts until the page reloads.
			}
			return { shown };
		}),
}));

/**
 * A document's text in the content language (Annex C §1.8, D32), for
 * detail views (the habit page title, identity cards). When the text is a
 * translation (template phrasebook or AI), a line under it says so —
 * "Translated from Portuguese" — with a "Show original" toggle
 * (`aria-pressed`, remembered for the session). Lists use `useText`
 * directly, without a marker. Owner: T5.
 */
export function TranslatedText({
	collection,
	entity,
	field,
	as: Tag = "span",
	className,
}: TranslatedTextProps) {
	const { t } = useT();
	const text = useText();
	const info = text.info(collection, entity, field);
	const id = typeof entity.id === "string" ? entity.id : "";
	const key = `${collection}:${id}:${field}`;
	const original = useShowOriginal((s) => s.shown.has(key));
	const toggle = useShowOriginal((s) => s.toggle);

	if (info.source === "original") return <Tag className={className}>{info.text}</Tag>;

	const raw = entity[field];
	const shown = original && typeof raw === "string" ? raw : info.text;
	const language =
		info.from === "en" || info.from === "pt-BR"
			? t("ai.translated", { language: t(`ai.language.${info.from}` as MessageKey) })
			: t("ai.translatedPlain");
	// The wrapper takes the host's placement (flex sizing, margins) so its layout holds.
	const { layout, rest } = splitLayoutClasses(className);
	return (
		<div className={cn("min-w-0", layout)}>
			{/* The original keeps its own language for screen readers. */}
			<Tag className={rest} lang={original && info.from ? info.from : undefined}>
				{shown}
			</Tag>
			<p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-ink-muted text-small">
				<span className="inline-flex items-center gap-1.5">
					<Languages aria-hidden="true" className="size-3.5 shrink-0" />
					{language}
				</span>
				<button
					type="button"
					aria-pressed={original}
					onClick={() => toggle(key)}
					className={cn(
						"inline-flex h-6 items-center rounded-full border px-2.5 font-medium text-tiny transition-colors duration-(--atomic-duration-fast)",
						original
							? "border-ink bg-ink text-bg hover:bg-ink/90"
							: "border-line bg-surface text-ink hover:border-line-strong hover:bg-hover",
					)}
				>
					{t("ai.showOriginal")}
				</button>
			</p>
		</div>
	);
}
