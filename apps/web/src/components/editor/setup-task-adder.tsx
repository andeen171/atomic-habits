import { useT } from "@/lib/messages";
import type { RepeatRule, SetupTaskDraft, TaskLaw } from "@atomic/core";
import { useAtomic, useToday } from "@atomic/core/react";
import { Plus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { RepeatField, sameRule } from "../tasks/repeat-field";
import { Button } from "../ui/button";
import { Input } from "../ui/field";
import { IconButton } from "../ui/icon-button";
import type { HabitDraft } from "./draft";
import type { DraftUpdate } from "./editor-fields";
import { defaultSetupRepeat, lawName, newSetupDraft, useSameDaysPreset } from "./setup-shared";

export interface SetupTaskAdderProps {
	/** The law step it sits at the bottom of (free-form setup tasks exist for every law, both kinds). */
	law: TaskLaw;
	draft: HabitDraft;
	update: DraftUpdate;
}

/**
 * "+ Add setup task" at the bottom of a law step (Annex T §4.4, as amended
 * by D15: every law, both kinds). Each row is a free-form draft
 * (`field: null`): a title input (`setup.titlePlaceholder[Break]`), a
 * compact repeat chip (with "Same days as the habit"; it follows the title's wording until the user picks
 * one) and a remove button. Enter adds the next row. Rows without a title
 * are dropped on save.
 */
export function SetupTaskAdder({ law, draft, update }: SetupTaskAdderProps) {
	const { t } = useT();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const rows = draft.setupTasks.filter((d) => d.field === null && d.law === law);
	const inputs = useRef(new Map<string, HTMLInputElement>());
	const addButton = useRef<HTMLButtonElement>(null);
	/** Where focus goes after the next render: a new row's input, or the add button. */
	const focusNext = useRef<string | "add" | null>(null);
	const isBreak = draft.kind === "break";
	const sameDays = useSameDaysPreset(draft, today);
	const law_ = lawName(law, draft.kind, t);

	useEffect(() => {
		const target = focusNext.current;
		if (!target) return;
		focusNext.current = null;
		if (target === "add") addButton.current?.focus();
		else inputs.current.get(target)?.focus();
	});

	const patch = (key: string, changes: Partial<SetupTaskDraft>) =>
		update({
			setupTasks: draft.setupTasks.map((d) => (d.key === key ? { ...d, ...changes } : d)),
		});

	const add = (after?: string) => {
		const row = newSetupDraft({ field: null, law, title: "", repeat: null, date: today });
		const list = [...draft.setupTasks];
		const index = after ? list.findIndex((d) => d.key === after) : -1;
		list.splice(index >= 0 ? index + 1 : list.length, 0, row);
		focusNext.current = row.key;
		update({ setupTasks: list });
	};

	const remove = (key: string) => {
		const index = rows.findIndex((d) => d.key === key);
		const neighbour = rows[index + 1] ?? rows[index - 1];
		focusNext.current = neighbour ? neighbour.key : "add";
		update({ setupTasks: draft.setupTasks.filter((d) => d.key !== key) });
	};

	const rename = (row: SetupTaskDraft, title: string) => {
		// The repeat follows the wording ("…every night") until the user picks one.
		const before = defaultSetupRepeat(row.title ?? "", row.date, weekStartsOn);
		const changes: Partial<SetupTaskDraft> = { title };
		if (sameRule(row.repeat, before)) {
			changes.repeat = defaultSetupRepeat(title, row.date, weekStartsOn);
		}
		patch(row.key, changes);
	};

	const setRepeat = (row: SetupTaskDraft, repeat: RepeatRule | null) => patch(row.key, { repeat });

	return (
		<div className="flex flex-col gap-2">
			{rows.length ? (
				<ul className="flex flex-col gap-3">
					<AnimatePresence initial={false}>
						{rows.map((row) => (
							<motion.li
								key={row.key}
								initial={{ opacity: 0, height: 0 }}
								animate={{ opacity: 1, height: "auto" }}
								exit={{ opacity: 0, height: 0 }}
								transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
								// Padding keeps the focus ring inside the clip while the row animates.
								className="-m-1 overflow-hidden p-1"
							>
								<div className="flex items-start gap-1.5">
									<div className="flex min-w-0 flex-1 flex-col gap-1.5">
										<Input
											ref={(el) => {
												if (el) inputs.current.set(row.key, el);
												else inputs.current.delete(row.key);
											}}
											value={row.title ?? ""}
											maxLength={280}
											aria-label={`${t("setup.titleLabel")} · ${law_}`}
											placeholder={t(
												isBreak ? "setup.titlePlaceholderBreak" : "setup.titlePlaceholder",
											)}
											onChange={(event) => rename(row, event.target.value)}
											onKeyDown={(event) => {
												if (event.key === "Enter" && !event.nativeEvent.isComposing) {
													event.preventDefault();
													if (row.title?.trim()) add(row.key);
												} else if (event.key === "Backspace" && !row.title) {
													event.preventDefault();
													remove(row.key);
												}
											}}
											className="min-w-0"
										/>
										<RepeatField
											compact
											value={row.repeat}
											onChange={(repeat) => setRepeat(row, repeat)}
											start={row.date}
											weekStartsOn={weekStartsOn}
											noneLabel={t("repeat.once")}
											extraPresets={row.date === today ? sameDays : undefined}
										/>
									</div>
									<IconButton
										label={t("setup.remove")}
										onClick={() => remove(row.key)}
										className="mt-1"
									>
										<X />
									</IconButton>
								</div>
							</motion.li>
						))}
					</AnimatePresence>
				</ul>
			) : null}
			<Button
				ref={addButton}
				variant="ghost"
				size="sm"
				onClick={() => add()}
				className="-ml-3 h-auto min-h-8 self-start whitespace-normal py-1.5 text-left"
			>
				<Plus />
				<span>
					{t("setup.add")}
					<span className="text-ink-subtle"> · {law_}</span>
				</span>
			</Button>
		</div>
	);
}
