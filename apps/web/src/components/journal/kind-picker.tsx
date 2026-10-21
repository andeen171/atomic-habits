import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
	type Habit,
	JOURNAL_GROUPS,
	JOURNAL_KINDS,
	JOURNAL_KIND_SPECS,
	type JournalKind,
	type MessageKey,
	journalKindHintKey,
	journalKindKey,
	journalKindUnavailable,
} from "@atomic/core";
import { useHabits, useIdentities, useIdentity, useText } from "@atomic/core/react";
import { ChevronRight } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, type ReactNode, useId } from "react";
import { JournalKindIcon } from "./kind-icon";

/**
 * Arrow keys (and Home / End) move focus between the options of a picker,
 * which keeps a single tab stop (`tabIndex` 0 on the first option).
 * Unavailable options stay focusable so their reason can be read.
 */
function onRovingKeyDown(event: KeyboardEvent<HTMLElement>) {
	const keys: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
	const delta = keys[event.key];
	const edge = event.key === "Home" ? "first" : event.key === "End" ? "last" : null;
	if (!delta && !edge) return;
	const options = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-option]")];
	if (!options.length) return;
	event.preventDefault();
	const index = options.indexOf(document.activeElement as HTMLElement);
	const next = edge
		? edge === "first"
			? 0
			: options.length - 1
		: (Math.max(index, 0) + (delta ?? 0) + options.length) % options.length;
	const target = options[next];
	if (!target) return;
	for (const option of options) option.tabIndex = option === target ? 0 : -1;
	target.focus();
}

interface OptionCardProps {
	icon: ReactNode;
	title: ReactNode;
	/** The kind's or habit's description, or the reason it can't be picked. */
	detail?: ReactNode;
	unavailable?: boolean;
	first: boolean;
	onPick(): void;
	style?: CSSProperties;
}

function OptionCard({ icon, title, detail, unavailable, first, onPick, style }: OptionCardProps) {
	const detailId = useId();
	return (
		<button
			type="button"
			data-option=""
			tabIndex={first ? 0 : -1}
			aria-disabled={unavailable ? true : undefined}
			aria-describedby={detail ? detailId : undefined}
			onClick={unavailable ? undefined : onPick}
			style={style}
			className={cn(
				"group flex w-full items-center gap-3.5 rounded-xl border p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-(--atomic-duration-fast)",
				unavailable
					? "cursor-default border-line border-dashed bg-transparent"
					: "border-line bg-surface shadow-card hover:border-line-strong hover:bg-hover active:scale-[0.99]",
			)}
		>
			{icon}
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span
					className={cn(
						"break-words font-semibold leading-snug",
						unavailable ? "text-ink-muted" : "text-ink",
					)}
				>
					{title}
				</span>
				{detail ? (
					<span
						id={detailId}
						className={cn(
							"break-words text-small",
							unavailable ? "text-ink-subtle italic" : "text-ink-muted",
						)}
					>
						{detail}
					</span>
				) : null}
			</span>
			{unavailable ? null : (
				<ChevronRight
					aria-hidden="true"
					className="size-4 shrink-0 text-ink-subtle transition-transform duration-(--atomic-duration-fast) group-hover:translate-x-0.5 motion-reduce:transition-none"
				/>
			)}
		</button>
	);
}

/**
 * "What do you want to write?" (Annex J §4): the nine kinds in their groups
 * (Quick, Plan, Reflect, Free), each a card with its icon, name and the
 * book idea behind it. A kind whose habit or identity requirement can't be
 * met shows the reason instead and can't be picked. Picking calls `onPick`.
 */
export function JournalKindPicker({ onPick }: { onPick(kind: JournalKind): void }) {
	const { t } = useT();
	const habits = useHabits();
	const identities = useIdentities();
	const headingId = useId();
	let firstAssigned = false;
	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-8">
			<h2
				id={headingId}
				className="text-balance font-display text-ink text-title md:text-[2.5rem] md:leading-[2.75rem]"
			>
				{t("journal.pickKind")}
			</h2>
			{/* One roving group for every option, so arrows cross group boundaries. */}
			<div onKeyDown={onRovingKeyDown} className="flex flex-col gap-8">
				{JOURNAL_GROUPS.map((group) => {
					const kinds = JOURNAL_KINDS.filter((kind) => JOURNAL_KIND_SPECS[kind].group === group);
					const groupId = `${headingId}-${group}`;
					return (
						<section key={group} aria-labelledby={groupId}>
							<h3 id={groupId} className="section-label mb-3">
								{t(`journal.group.${group}` as MessageKey)}
							</h3>
							<ul className="grid gap-2.5 sm:grid-cols-2">
								{kinds.map((kind) => {
									const reason = journalKindUnavailable(kind, { habits, identities });
									const first = !firstAssigned;
									firstAssigned = true;
									return (
										<li key={kind} className="flex">
											<OptionCard
												first={first}
												unavailable={reason !== null}
												icon={<JournalKindIcon kind={kind} muted={reason !== null} />}
												title={t(journalKindKey(kind))}
												detail={reason ? t(reason) : t(journalKindHintKey(kind))}
												onPick={() => onPick(kind)}
											/>
										</li>
									);
								})}
							</ul>
						</section>
					);
				})}
			</div>
		</section>
	);
}

function HabitOption({ habit, first, onPick }: { habit: Habit; first: boolean; onPick(): void }) {
	const text = useText();
	const style = useHabitStyle(habit.color);
	const identity = useIdentity(habit.identityId);
	return (
		<OptionCard
			first={first}
			style={style}
			icon={
				<span
					aria-hidden="true"
					className="grid size-10 shrink-0 place-items-center rounded-lg bg-(--habit-soft) font-emoji text-xl leading-none"
				>
					{habit.emoji}
				</span>
			}
			title={text.habit(habit, "name")}
			detail={identity ? text.identity(identity, "statement") : undefined}
			onPick={onPick}
		/>
	);
}

/**
 * "Which habit?" (Annex J §4): the habit step of a kind that needs one
 * (comeback plan, check-in, contract), listing only live, unarchived habits
 * of the right kind. `habits` is that eligible list; empty, it explains
 * what's missing and links to the habit editor.
 */
export function JournalHabitPicker({
	kind,
	habits,
	onPick,
	empty,
}: {
	kind: JournalKind;
	habits: readonly Habit[];
	onPick(habit: Habit): void;
	/** Shown instead of the list when no habit qualifies. */
	empty: ReactNode;
}) {
	const { t } = useT();
	const headingId = useId();
	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-6">
			<div className="flex items-center gap-3">
				<JournalKindIcon kind={kind} />
				<p className="font-semibold text-ink-muted">{t(journalKindKey(kind))}</p>
			</div>
			<h2
				id={headingId}
				className="-mt-2 text-balance font-display text-ink text-title md:text-[2.5rem] md:leading-[2.75rem]"
			>
				{t("journal.pickHabit")}
			</h2>
			{habits.length ? (
				<ul onKeyDown={onRovingKeyDown} className="grid gap-2.5 sm:grid-cols-2">
					{habits.map((habit, index) => (
						<li key={habit.id} className="flex">
							<HabitOption habit={habit} first={index === 0} onPick={() => onPick(habit)} />
						</li>
					))}
				</ul>
			) : (
				empty
			)}
		</section>
	);
}
