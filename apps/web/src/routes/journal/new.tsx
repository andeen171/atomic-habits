import { displayHabit } from "@/components/habit/display-habit";
import {
	JournalEditor,
	JournalFrame,
	useCloseJournal,
	useFocusHeadingOnMount,
} from "@/components/journal/journal-editor";
import { JournalHabitPicker, JournalKindPicker } from "@/components/journal/kind-picker";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/lib/messages";
import {
	type DayKey,
	type Habit,
	JOURNAL_KIND_SPECS,
	type JournalKind,
	type MessageKey,
	type ReviewScope,
	isDayKey,
	isJournalKind,
	journalEligibleHabits,
	journalKindUnavailable,
	newJournalDraft,
	slipPrefill,
	toDayKey,
} from "@atomic/core";
import {
	useAtomic,
	useHabits,
	useIdentities,
	useText,
	useToday,
	useTrackerEntryIndex,
} from "@atomic/core/react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Plus } from "lucide-react";
import { useRef, useState } from "react";

/** Prefills of a new entry (Annex J §1.4, §4). Without `kind`, the kind picker shows. */
export interface NewJournalSearch {
	kind?: JournalKind;
	identity?: string;
	habit?: string;
	/** The day the entry is about (never after today). */
	date?: DayKey;
	/** A review's period. */
	scope?: ReviewScope;
}

const SCOPES: readonly ReviewScope[] = ["week", "month", "year"];

const id = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : undefined;

export const Route = createFileRoute("/journal/new")({
	validateSearch: (search: Record<string, unknown>): NewJournalSearch => {
		const out: NewJournalSearch = {};
		if (isJournalKind(search.kind)) out.kind = search.kind;
		const identity = id(search.identity);
		const habit = id(search.habit);
		if (identity) out.identity = identity;
		if (habit) out.habit = habit;
		if (isDayKey(search.date) && search.date <= toDayKey()) out.date = search.date;
		if (SCOPES.includes(search.scope as ReviewScope)) out.scope = search.scope as ReviewScope;
		return out;
	},
	component: NewJournalEntryScreen,
});

/**
 * A new journal entry, outside the shell like the habit editor (Annex J §4):
 * the kind picker, then the habit step when the kind needs a habit and none
 * was given, then the editor with the kind's prefills. Each step replaces
 * the previous one in history, so Back leaves the flow. Owner: T3.
 */
function NewJournalEntryScreen() {
	const search = Route.useSearch();
	if (!search.kind) return <KindStep search={search} />;
	return <KindFlow kind={search.kind} search={search} />;
}

function KindStep({ search }: { search: NewJournalSearch }) {
	const { t } = useT();
	const navigate = useNavigate();
	const close = useCloseJournal();
	const ref = useRef<HTMLDivElement>(null);
	useFocusHeadingOnMount(ref);
	return (
		<JournalFrame title={t("create.journalEntry")} onClose={close}>
			<div ref={ref}>
				<JournalKindPicker
					onPick={(kind) =>
						void navigate({ to: "/journal/new", search: { ...search, kind }, replace: true })
					}
				/>
			</div>
		</JournalFrame>
	);
}

function KindFlow({ kind, search }: { kind: JournalKind; search: NewJournalSearch }) {
	const habits = useHabits();
	const spec = JOURNAL_KIND_SPECS[kind];
	const needsHabit = spec.habit === "build" || spec.habit === "break" || spec.habit === "any";
	const eligible = needsHabit ? journalEligibleHabits(kind, habits) : habits;
	const habit =
		spec.habit === "hidden" || !search.habit
			? undefined
			: eligible.find((h) => h.id === search.habit);
	if (needsHabit && !habit) return <HabitStep kind={kind} search={search} habits={eligible} />;
	// A new prefill (another habit, day or period) starts a fresh editor.
	return <NewEntryEditor key={JSON.stringify(search)} kind={kind} search={search} habit={habit} />;
}

function HabitStep({
	kind,
	search,
	habits,
}: { kind: JournalKind; search: NewJournalSearch; habits: Habit[] }) {
	const { t } = useT();
	const navigate = useNavigate();
	const close = useCloseJournal();
	const identities = useIdentities();
	const ref = useRef<HTMLDivElement>(null);
	useFocusHeadingOnMount(ref);
	const reason = journalKindUnavailable(kind, { habits, identities });
	return (
		<JournalFrame title={t("create.journalEntry")} onClose={close}>
			<div ref={ref} className="flex flex-col gap-8">
				<JournalHabitPicker
					kind={kind}
					habits={habits}
					onPick={(habit) =>
						void navigate({
							to: "/journal/new",
							search: { ...search, habit: habit.id },
							replace: true,
						})
					}
					empty={
						<div className="rounded-xl border border-line bg-surface shadow-card">
							<EmptyState
								compact
								title={t((reason ?? "journal.needsHabit") as MessageKey)}
								body={t("journal.noEligibleHabit")}
								action={
									<Button asChild>
										<Link to="/habits/new">
											<Plus />
											{t("habits.new")}
										</Link>
									</Button>
								}
							/>
						</div>
					}
				/>
				<div>
					<Button
						variant="ghost"
						className="-ml-3"
						onClick={() =>
							void navigate({
								to: "/journal/new",
								search: { ...search, kind: undefined, habit: undefined },
								replace: true,
							})
						}
					>
						<ArrowLeft />
						{t("common.back")}
					</Button>
				</div>
			</div>
		</JournalFrame>
	);
}

function NewEntryEditor({
	kind,
	search,
	habit,
}: { kind: JournalKind; search: NewJournalSearch; habit: Habit | undefined }) {
	const { t } = useT();
	const text = useText();
	const navigate = useNavigate();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const identities = useIdentities();
	const trackers = useTrackerEntryIndex();
	// The draft is built once: prefills from the habit (its text in the content
	// language), the identity, the day and, after a slip, the slip's own note and cue.
	const [initial] = useState(() => {
		const identity = identities.find((item) => item.id === search.identity);
		const day = search.date ?? today;
		const prefill =
			kind === "recovery" && habit?.kind === "break"
				? slipPrefill(trackers, habit.id, day)
				: undefined;
		return newJournalDraft(kind, {
			today,
			weekStartsOn,
			t,
			habit: habit ? displayHabit(habit, text) : undefined,
			// The statement in the content language: a belief's new story starts from it.
			identity: identity
				? { ...identity, statement: text.identity(identity, "statement") }
				: undefined,
			date: search.date,
			scope: search.scope,
			prefill,
		});
	});
	const spec = JOURNAL_KIND_SPECS[kind];
	const required = spec.habit === "build" || spec.habit === "break" || spec.habit === "any";
	return (
		<JournalEditor
			initial={initial}
			onChangeHabit={
				required
					? (habitId) =>
							void navigate({
								to: "/journal/new",
								search: { ...search, habit: habitId },
								replace: true,
							})
					: undefined
			}
		/>
	);
}
