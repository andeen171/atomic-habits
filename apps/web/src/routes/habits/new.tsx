import { HABIT_KINDS, type HabitKind, habitTemplates } from "@atomic/core";
import { useLocale } from "@atomic/core/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { applyTemplate, emptyDraft } from "@/components/editor/draft";
import { HabitEditor } from "@/components/editor/habit-editor";

interface NewHabitSearch {
	/** Prefill from a habit template key (e.g. "read"). */
	template?: string;
	kind?: HabitKind;
	/** Prefill the name (e.g. from a scorecard behavior). */
	name?: string;
	identity?: string;
}

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : undefined);

export const Route = createFileRoute("/habits/new")({
	validateSearch: (search: Record<string, unknown>): NewHabitSearch => {
		const kind = HABIT_KINDS.includes(search.kind as HabitKind) ? (search.kind as HabitKind) : undefined;
		const out: NewHabitSearch = {};
		if (str(search.template)) out.template = str(search.template);
		if (kind) out.kind = kind;
		if (str(search.name)) out.name = str(search.name);
		if (str(search.identity)) out.identity = str(search.identity);
		return out;
	},
	component: NewHabitScreen,
});

function NewHabitScreen() {
	const search = Route.useSearch();
	const locale = useLocale();
	const [initial] = useState(() => {
		let draft = emptyDraft(search.kind);
		const template = search.template ? habitTemplates(locale).find((tpl) => tpl.key === search.template) : undefined;
		if (template) draft = applyTemplate(draft, template);
		if (search.name) draft = { ...draft, name: search.name };
		if (search.identity) draft = { ...draft, identityId: search.identity };
		return draft;
	});
	return <HabitEditor initial={initial} />;
}
