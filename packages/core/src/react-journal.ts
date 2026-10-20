import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { identityStats } from "./agenda";
import type { DayKey } from "./dates";
import { habitStats, logsFor } from "./habits";
import {
	type IdentityJournalStats,
	type JournalCheck,
	type JournalDraft,
	type JournalEditorStatus,
	type JournalFilter,
	type JournalTimelineItem,
	activeContract,
	checkJournalEntry,
	createJournalEditor,
	identityJournalStats,
	journalTimeline,
	latestIntegrity,
	liveJournal,
	recoveryFor,
} from "./journal";
import {
	type CheckinReason,
	type GoldilocksSuggestion,
	type JournalNudge,
	type ReviewSnapshot,
	applyGoldilocks,
	checkinReason,
	goldilocksSuggestion,
	journalNudge,
	reviewSnapshot,
} from "./journal-review";
import type { CheckinDifficulty, Habit, JournalEntry, JournalRange } from "./model";
import { levelUpSuggestion } from "./month";
import { useAtomic, useAtomicStore, useLogIndex, useToday } from "./react-context";
import { useLevelUpSuggestion } from "./react-month";

/**
 * Journal hooks (Annex J §3.4). React module: exported from `react.ts` only
 * (spec §3, D52). They memoise on raw store slices and the shared log index
 * (`indexes.ts`). Owner: T3.
 */

/** Live entries, newest first. */
export function useJournal(): JournalEntry[] {
	const records = useAtomic((s) => s.data.journal);
	return useMemo(() => liveJournal(records), [records]);
}

/** A live entry, or undefined (missing or deleted). */
export function useJournalEntry(id: string | undefined): JournalEntry | undefined {
	return useAtomic((s) => {
		const entry = id ? s.data.journal[id] : undefined;
		return entry && !entry.deletedAt ? entry : undefined;
	});
}

/** Entries and day notes matching a filter (Annex J §1.10). */
export function useJournalTimeline(filter: JournalFilter): JournalTimelineItem[] {
	const journal = useJournal();
	const logs = useAtomic((s) => s.data.logs);
	const habits = useAtomic((s) => s.data.habits);
	const identities = useAtomic((s) => s.data.identities);
	const { identityId, habitId, from, to, query } = filter;
	const kinds = filter.kinds?.join(",") ?? "";
	return useMemo(
		() =>
			journalTimeline(
				{ journal, logs, habits, identities },
				{
					identityId,
					habitId,
					from,
					to,
					query,
					kinds: kinds ? (kinds.split(",") as JournalFilter["kinds"]) : undefined,
				},
			),
		[journal, logs, habits, identities, identityId, habitId, from, to, query, kinds],
	);
}

/** Evidence count, entry count and the newest entry per identity id. */
export function useIdentityJournalStats(): Map<string, IdentityJournalStats> {
	const journal = useJournal();
	return useMemo(() => identityJournalStats(journal), [journal]);
}

/** How many timeline items the habit-detail section shows. */
export const HABIT_JOURNAL_LIMIT = 20;

/**
 * The habit detail's "Journal & notes" (Annex J §1.5): the 20 newest
 * entries and day notes (`total` counts all of them), the active contract,
 * and the Goldilocks check-in prompt, which never says "strong" while the
 * habit's level-up card is visible (D9). The page passes `levelUpVisible`
 * when it knows whether it shows that card; otherwise the card counts as
 * visible whenever the habit has a level-up suggestion.
 */
export function useHabitJournal(
	habitId: string,
	options: { levelUpVisible?: boolean } = {},
): {
	items: JournalTimelineItem[];
	total: number;
	contract: JournalEntry | undefined;
	checkin: CheckinReason | null;
} {
	const timeline = useJournalTimeline({ habitId });
	const journal = useJournal();
	const habit = useAtomic((s) => s.data.habits[habitId]);
	const index = useLogIndex();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const { levelUpVisible } = options;
	return useMemo(() => {
		let checkin: CheckinReason | null = null;
		if (habit && !habit.deletedAt) {
			const logs = logsFor(index, habit.id);
			const stats = habitStats(habit, logs, today, weekStartsOn);
			const levelUp =
				levelUpVisible ?? levelUpSuggestion(habit, logs, today, weekStartsOn) !== null;
			checkin = checkinReason(habit, stats, journal, today, levelUp);
		}
		return {
			items: timeline.slice(0, HABIT_JOURNAL_LIMIT),
			total: timeline.length,
			contract: activeContract(journal, habitId, today),
			checkin,
		};
	}, [timeline, journal, habit, habitId, index, today, weekStartsOn, levelUpVisible]);
}

/** The recovery plan for a habit's missed or slipped day (Today's banners). */
export function useRecoveryPlan(habitId: string, day: DayKey | null): JournalEntry | undefined {
	const journal = useJournal();
	return useMemo(
		() => (day ? recoveryFor(journal, habitId, day) : undefined),
		[journal, habitId, day],
	);
}

/** The newest Integrity Report with values (the Identity values card). */
export function useLatestIntegrity(): JournalEntry | undefined {
	const journal = useJournal();
	return useMemo(() => latestIntegrity(journal), [journal]);
}

/**
 * Today's one journal nudge (Annex J §1.5) for the real today, honouring
 * the review cadence and this device's dismissals. The apps show it only
 * while viewing today.
 */
export function useJournalNudge(dismissed: ReadonlySet<string>): JournalNudge | null {
	const journal = useJournal();
	const habits = useAtomic((s) => s.data.habits);
	const cadence = useAtomic((s) => s.settings.reviewCadence);
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const identities = useAtomic((s) => s.data.identities);
	const index = useLogIndex();
	const today = useToday();
	return useMemo(() => {
		const list = Object.values(habits);
		const live = Object.values(identities).filter((i) => !i.deletedAt);
		return journalNudge({
			today,
			habits: list,
			index,
			journal,
			identities: identityStats(live, list, index, today),
			cadence,
			weekStartsOn,
			dismissed,
		});
	}, [today, habits, identities, index, journal, cadence, weekStartsOn, dismissed]);
}

/** The review editor's live numbers for a period (Annex J §1.7), or null without a range. */
export function useReviewSnapshot(range: JournalRange | null): ReviewSnapshot | null {
	const journal = useJournal();
	const habits = useAtomic((s) => s.data.habits);
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const index = useLogIndex();
	const today = useToday();
	const from = range?.from;
	const to = range?.to;
	return useMemo(
		() =>
			from && to
				? reviewSnapshot({
						range: { from, to },
						today,
						habits: Object.values(habits),
						index,
						journal,
						weekStartsOn,
					})
				: null,
		[from, to, today, habits, index, journal, weekStartsOn],
	);
}

/**
 * The Goldilocks block (Annex J §1.8): the check-in's suggestion for a habit
 * (on "too easy", the month's level-up target when there is one, D9) and
 * `apply()`, which writes it and returns an Undo (or null when nothing
 * changed). Null suggestion before a difficulty is chosen.
 */
export function useGoldilocks(
	habit: Habit | undefined,
	difficulty: CheckinDifficulty | null,
): { suggestion: GoldilocksSuggestion; apply(): (() => void) | null } {
	const store = useAtomicStore();
	const levelUp = useLevelUpSuggestion(habit);
	return useMemo(() => {
		const suggestion =
			habit && difficulty ? goldilocksSuggestion(habit, difficulty, levelUp) : null;
		return {
			suggestion,
			apply: () => (habit ? applyGoldilocks(store, habit.id, suggestion, levelUp) : null),
		};
	}, [store, habit, difficulty, levelUp]);
}

export interface JournalEditorState {
	draft: JournalDraft;
	/** The stored entry, once the first change created it. */
	entryId: string | null;
	status: JournalEditorStatus;
	check: JournalCheck;
	setAnswer(id: string, value: string): void;
	update(patch: Partial<JournalDraft>): void;
	/** Writes pending changes now (page hide, app background). */
	flush(): void;
	/** Flushes and deletes an empty entry; runs on unmount too. Call on close. */
	finish(): JournalEntry | null;
	/** Flushes and signs the contract. */
	sign(): boolean;
}

/**
 * The journal editor's state and autosave (Annex J §1.3), identical on web
 * and native: opening writes nothing; the first change that leaves content
 * creates the entry (prefills included); later changes are written after
 * `debounceMs` (600); `finish()` flushes and deletes an entry with no
 * content. Options are read once: give the editor a `key` to edit another
 * entry. React StrictMode's extra unmount is harmless (the editor stays
 * usable after `finish`).
 */
export function useJournalEditor(o: {
	entryId?: string;
	initial?: JournalDraft;
	debounceMs?: number;
}): JournalEditorState {
	const store = useAtomicStore();
	const habits = useAtomic((s) => s.data.habits);
	const [editor] = useState(() =>
		createJournalEditor(store, {
			entryId: o.entryId,
			initial: o.initial,
			debounceMs: o.debounceMs,
		}),
	);
	const snapshot = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
	useEffect(
		() => () => {
			editor.finish();
		},
		[editor],
	);
	const check = useMemo(() => checkJournalEntry(snapshot.draft, habits), [snapshot.draft, habits]);
	return useMemo(
		() => ({
			draft: snapshot.draft,
			entryId: snapshot.entryId,
			status: snapshot.status,
			check,
			setAnswer: editor.setAnswer,
			update: editor.update,
			flush: editor.flush,
			finish: editor.finish,
			sign: editor.sign,
		}),
		[snapshot, check, editor],
	);
}
