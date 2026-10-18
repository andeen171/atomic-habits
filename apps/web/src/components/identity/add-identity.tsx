import { identityTemplates } from "@atomic/core";
import { useActions, useIdentities, useLocale } from "@atomic/core/react";
import { Plus } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { useT } from "@/lib/messages";
import { Button } from "../ui/button";
import { Input } from "../ui/field";

/** Inline form + suggestions from the identity templates. */
export function AddIdentity() {
	const { t } = useT();
	const actions = useActions();
	const locale = useLocale();
	const identities = useIdentities();
	const [statement, setStatement] = useState("");
	const suggestions = useMemo(() => {
		const existing = new Set(identities.map((i) => i.statement.toLowerCase()));
		return identityTemplates(locale).filter((tpl) => !existing.has(tpl.statement.toLowerCase()));
	}, [identities, locale]);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!statement.trim()) return;
		actions.createIdentity({ statement });
		setStatement("");
	};

	return (
		<section className="rounded-xl border border-line border-dashed bg-surface/60 p-5 md:p-6">
			<h2 className="mb-3 font-semibold text-h3 text-ink">{t("identity.add")}</h2>
			<form onSubmit={submit} className="flex gap-2">
				<Input
					value={statement}
					maxLength={120}
					aria-label={t("identity.add")}
					placeholder={t("identity.placeholder")}
					onChange={(event) => setStatement(event.target.value)}
				/>
				<Button type="submit" disabled={!statement.trim()} className="h-11">
					<Plus />
					<span className="hidden sm:inline">{t("common.add")}</span>
				</Button>
			</form>
			{suggestions.length ? (
				<div className="mt-4">
					<p className="mb-2 section-label">{t("identity.suggestions")}</p>
					<div className="flex flex-wrap gap-1.5">
						{suggestions.map((tpl) => (
							<button
								key={tpl.key}
								type="button"
								onClick={() => actions.createIdentity({ statement: tpl.statement, emoji: tpl.emoji, color: tpl.color })}
								className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-ink-muted text-small transition-colors hover:border-line-strong hover:text-ink"
							>
								<span className="font-emoji">{tpl.emoji}</span>
								{tpl.statement}
								<Plus className="size-3.5 text-ink-subtle" />
							</button>
						))}
					</div>
				</div>
			) : null}
		</section>
	);
}
