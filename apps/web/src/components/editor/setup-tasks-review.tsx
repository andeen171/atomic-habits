import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import {
	type SetupTaskDraft,
	type TaskItem,
	anchorOf,
	pruneSetupDrafts,
	repeatLabel,
	setupFieldsFor,
} from "@atomic/core";
import {
	useAtomic,
	useHabitSetupTasks,
	useIdentities,
	useText,
	useToday,
} from "@atomic/core/react";
import { ChevronRight, ListChecks, Plus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId } from "react";
import { AiSuggest } from "../ai/ai-suggest";
import { taskDateLabel } from "../tasks/task-date";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import type { HabitDraft } from "./draft";
import type { DraftUpdate } from "./editor-fields";
import {
	SetupMeta,
	defaultSetupRepeat,
	draftFieldText,
	lawName,
	newSetupDraft,
	setupTitle,
	useSetupRetitleOnSave,
} from "./setup-shared";

export interface SetupTasksReviewProps {
	draft: HabitDraft;
	update: DraftUpdate;
	/** The habit being edited (edit mode), to list the tasks already linked. */
	habitId?: string;
}

/**
 * The setup tasks the habit will create, on the editor's review step and at
 * the end of the quick form (Annex T §4.4): each resolved draft (its title,
 * law and "Once · Today" or the repeat) with a remove button; in edit mode
 * the tasks already linked (they open in the task dialog); "Suggested" rows
 * for filled convertible fields that aren't tasks yet, each with "Add";
 * `AiSuggest habit.setupTasks`; and `setup.reviewEmpty` when there's nothing.
 */
export function SetupTasksReview({ draft, update, habitId }: SetupTasksReviewProps) {
	const { t } = useT();
	const text = useText();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const identities = useIdentities();
	const openTaskDialog = useUI((s) => s.openTaskDialog);
	const setup = useHabitSetupTasks(habitId);
	const titleId = useId();
	const suggestedId = useId();
	useSetupRetitleOnSave(habitId);

	const kind = draft.kind;
	const fields = draftFieldText(draft);
	const drafts = pruneSetupDrafts(draft.setupTasks, kind);
	// Law order (1–4), then the order they were added in.
	const rows = drafts
		.map((d) => ({ draft: d, title: setupTitle(d.title ?? (d.field ? fields[d.field] : null)) }))
		.filter((row) => row.title)
		.sort((a, b) => a.draft.law - b.draft.law);
	const linked: TaskItem[] = habitId ? [...setup.active, ...setup.paused] : [];
	const suggestions = setupFieldsFor(kind).filter(
		(spec) =>
			setupTitle(fields[spec.field]) &&
			!drafts.some((d) => d.field === spec.field) &&
			!(habitId && setup.byField.get(spec.field)?.length),
	);
	const empty = !rows.length && !linked.length && !suggestions.length;
	const identity =
		draft.newIdentity?.trim() || identities.find((i) => i.id === draft.identityId)?.statement;

	const repeatText = (d: Pick<SetupTaskDraft, "repeat" | "date">) =>
		d.repeat
			? repeatLabel(d.repeat, t, { start: d.date, weekStartsOn })
			: `${t("repeat.once")} · ${taskDateLabel(d.date, today, t)}`;

	const remove = (key: string) =>
		update({ setupTasks: draft.setupTasks.filter((d) => d.key !== key) });

	const append = (row: SetupTaskDraft) => update({ setupTasks: [...draft.setupTasks, row] });

	return (
		<section
			aria-labelledby={titleId}
			className="rounded-xl border border-line bg-surface p-5 shadow-card md:p-6"
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 id={titleId} className="font-semibold text-h3 text-ink">
						{t("setup.title")}
					</h2>
					<p className="mt-0.5 text-ink-muted text-small">
						{t(kind === "break" ? "setup.hintBreak" : "setup.hint")}
					</p>
				</div>
				<AiSuggest
					kind="habit.setupTasks"
					label={t("setup.title")}
					disabled={!draft.name.trim()}
					input={() => ({
						habit: draft.name.trim().slice(0, 80),
						kind,
						identity: identity?.slice(0, 120),
					})}
					onPick={(pick) =>
						append(
							newSetupDraft({
								field: null,
								law: pick.law,
								title: pick.title,
								repeat: defaultSetupRepeat(pick.title, today, weekStartsOn),
								date: today,
							}),
						)
					}
				/>
			</div>

			{rows.length || linked.length ? (
				<ul className="mt-4 overflow-hidden rounded-lg border border-line">
					{linked.map((item) => {
						const repeat = item.task.repeat
							? repeatLabel(item.task.repeat, t, {
									start: anchorOf(item.task),
									weekStartsOn,
									short: true,
								})
							: t("repeat.once");
						const label = t("setup.linked", { repeat });
						const title = text.task(item.task, "title");
						return (
							<li key={item.key} className="border-line not-first:border-t">
								<button
									type="button"
									onClick={() => openTaskDialog({ mode: "edit", id: item.task.id })}
									aria-label={`${title}, ${label}`}
									className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hover/70"
								>
									<ListChecks
										aria-hidden="true"
										className="mt-0.5 size-4 shrink-0 text-accent-text"
									/>
									<span className="min-w-0 flex-1">
										<span className="block break-words text-ink">{title}</span>
										<span className="mt-0.5 block text-ink-muted text-small">
											{item.task.law ? `${lawName(item.task.law, kind, t)} · ` : ""}
											{label}
										</span>
									</span>
									<ChevronRight
										aria-hidden="true"
										className="mt-0.5 size-4 shrink-0 text-ink-subtle"
									/>
								</button>
							</li>
						);
					})}
					<AnimatePresence initial={false}>
						{rows.map(({ draft: row, title }) => (
							<motion.li
								key={row.key}
								initial={{ opacity: 0, height: 0 }}
								animate={{ opacity: 1, height: "auto" }}
								exit={{ opacity: 0, height: 0 }}
								transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
								className="overflow-hidden border-line not-first:border-t"
							>
								<div className="flex items-start gap-3 py-3 pr-2 pl-4">
									<span
										aria-hidden="true"
										className="mt-[3px] size-4 shrink-0 rounded-full border-[1.5px] border-line-strong"
									/>
									<div className="min-w-0 flex-1">
										<p className="break-words text-ink">{title}</p>
										<SetupMeta
											law={row.law}
											kind={kind}
											repeating={!!row.repeat}
											when={repeatText(row)}
										/>
									</div>
									<IconButton
										label={`${t("setup.remove")}: ${title}`}
										size="sm"
										onClick={() => remove(row.key)}
									>
										<X />
									</IconButton>
								</div>
							</motion.li>
						))}
					</AnimatePresence>
				</ul>
			) : null}

			{suggestions.length ? (
				<div className="mt-5">
					<h3 id={suggestedId} className="section-label mb-2 px-1">
						{t("setup.suggested")}
					</h3>
					<ul aria-labelledby={suggestedId} className="flex flex-col gap-2">
						{suggestions.map((spec) => {
							const title = setupTitle(fields[spec.field]);
							const repeat = defaultSetupRepeat(title, today, weekStartsOn);
							return (
								<li
									key={spec.field}
									className="flex items-center gap-3 rounded-lg border border-line-strong border-dashed bg-sunken/40 py-2.5 pr-2.5 pl-4"
								>
									<div className="min-w-0 flex-1">
										<p className="break-words text-ink">{title}</p>
										<SetupMeta
											law={spec.law}
											kind={kind}
											repeating={!!repeat}
											when={repeatText({ repeat, date: today })}
										/>
									</div>
									<Button
										variant="secondary"
										size="sm"
										aria-label={`${t("common.add")}: ${title}`}
										onClick={() =>
											append(
												newSetupDraft({
													field: spec.field,
													law: spec.law,
													title: null,
													repeat,
													date: today,
												}),
											)
										}
									>
										<Plus />
										{t("common.add")}
									</Button>
								</li>
							);
						})}
					</ul>
				</div>
			) : null}

			{empty ? <p className="mt-4 text-ink-muted text-small">{t("setup.reviewEmpty")}</p> : null}
		</section>
	);
}
