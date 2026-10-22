import { displayHabit } from "@/components/habit/display-habit";
import { Plus } from "@/components/icons";
import {
	JournalEditor,
	JournalEntryNotFound,
	JournalReadOnly,
	closeJournal,
	useAccessibilityFocusOnMount,
	wasDeletedHere,
} from "@/components/journal/journal-editor";
import { JournalHabitPicker, JournalKindPicker } from "@/components/journal/kind-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { makeStyles } from "@/lib/theme";
import {
	type DayKey,
	type Habit,
	JOURNAL_KIND_SPECS,
	type JournalKind,
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
	useJournalEntry,
	useText,
	useToday,
	useTrackerEntryIndex,
} from "@atomic/core/react";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Platform, View } from "react-native";

/**
 * Route params (Annex J §5). With `id`, edits that entry; otherwise a new
 * entry of `kind` (the kind picker when absent), linked and dated by the
 * other params.
 */
export type JournalEditorParams = {
	id?: string;
	kind?: string;
	identityId?: string;
	habitId?: string;
	/** DayKey, at most today. */
	date?: string;
	/** Review scope: "week" | "month" | "year". */
	scope?: string;
};

/** The params of a new entry, validated (Annex J §4–§5). */
interface NewEntryParams {
	kind?: JournalKind;
	identityId?: string;
	habitId?: string;
	date?: DayKey;
	scope?: ReviewScope;
}

const SCOPES: readonly ReviewScope[] = ["week", "month", "year"];

const idParam = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : undefined;

function validate(params: JournalEditorParams): NewEntryParams {
	const out: NewEntryParams = {};
	if (isJournalKind(params.kind)) out.kind = params.kind;
	const identityId = idParam(params.identityId);
	const habitId = idParam(params.habitId);
	if (identityId) out.identityId = identityId;
	if (habitId) out.habitId = habitId;
	if (isDayKey(params.date) && params.date <= toDayKey()) out.date = params.date;
	if (SCOPES.includes(params.scope as ReviewScope)) out.scope = params.scope as ReviewScope;
	return out;
}

/**
 * The journal editor (Annex J §5). Owner: T3. With `id`, that entry (read
 * only when a newer Atomic wrote its kind; "not found" when it's gone).
 * Otherwise a new entry: the kind picker, the habit step when the kind needs
 * a habit and none was given, then the editor with the kind's prefills.
 */
export default function JournalEditorScreen() {
	const raw = useLocalSearchParams<JournalEditorParams>();
	const id = idParam(raw.id);
	if (id) return <EntryScreen key={id} id={id} />;
	const params = validate(raw);
	// New params (a notification, another link) start the flow over.
	return <NewEntryFlow key={JSON.stringify(params)} params={params} />;
}

function EntryScreen({ id }: { id: string }) {
	const entry = useJournalEntry(id);
	// The editor stays mounted only while its own Delete leaves the screen.
	if (!wasDeletedHere(id, entry !== undefined) && !entry) return <JournalEntryNotFound />;
	if (entry && !isJournalKind(entry.kind)) return <JournalReadOnly entry={entry} />;
	return <JournalEditor entryId={id} />;
}

/**
 * The steps of a new entry live in this one screen. A kind picked here can
 * be changed again from the habit step (its Back, the hardware button);
 * a kind that came with the link leaves the screen instead.
 */
function NewEntryFlow({ params }: { params: NewEntryParams }) {
	const habits = useHabits();
	const [kind, setKind] = useState<JournalKind | undefined>(params.kind);
	const [habitId, setHabitId] = useState<string | undefined>(params.habitId);
	const picked = !params.kind;
	if (!kind) {
		return (
			<KindStep
				onPick={(next) => {
					setKind(next);
					setHabitId(params.habitId);
				}}
			/>
		);
	}
	const spec = JOURNAL_KIND_SPECS[kind];
	const needsHabit = spec.habit === "build" || spec.habit === "break" || spec.habit === "any";
	const eligible = needsHabit ? journalEligibleHabits(kind, habits) : habits;
	const habit =
		spec.habit === "hidden" || !habitId ? undefined : eligible.find((h) => h.id === habitId);
	if (needsHabit && !habit) {
		return (
			<HabitStep
				kind={kind}
				habits={eligible}
				onPick={(next) => setHabitId(next.id)}
				onBack={picked ? () => setKind(undefined) : undefined}
			/>
		);
	}
	// A new prefill (another habit) starts a fresh editor.
	return (
		<NewEntryEditor
			key={`${kind}:${habit?.id ?? ""}`}
			kind={kind}
			params={params}
			habit={habit}
			onChangeHabit={needsHabit ? setHabitId : undefined}
		/>
	);
}

function KindStep({ onPick }: { onPick(kind: JournalKind): void }) {
	const t = useT();
	const styles = useStyles();
	const ref = useRef<View>(null);
	useAccessibilityFocusOnMount(ref);
	return (
		<Screen back onBack={closeJournal} title={t.t("create.journalEntry")} testID="journal-editor">
			<View ref={ref}>
				<Text variant="small" tone="muted" weight="medium" style={styles.eyebrow}>
					{t.t("create.journalEntry")}
				</Text>
				<JournalKindPicker onPick={onPick} />
			</View>
		</Screen>
	);
}

function HabitStep({
	kind,
	habits,
	onPick,
	onBack,
}: {
	kind: JournalKind;
	habits: Habit[];
	onPick(habit: Habit): void;
	/** Back to the kind picker (when the kind was picked here). */
	onBack?: () => void;
}) {
	const t = useT();
	const styles = useStyles();
	const identities = useIdentities();
	const ref = useRef<View>(null);
	useAccessibilityFocusOnMount(ref);
	const reason = journalKindUnavailable(kind, { habits, identities });
	const back = onBack ?? closeJournal;

	// Android back returns to the kind picker rather than leaving.
	useEffect(() => {
		if (Platform.OS === "web" || !onBack) return;
		const sub = BackHandler.addEventListener("hardwareBackPress", () => {
			onBack();
			return true;
		});
		return () => sub.remove();
	}, [onBack]);

	return (
		<Screen back onBack={back} title={t.t("journal.pickHabit")} testID="journal-editor">
			<View ref={ref}>
				<JournalHabitPicker
					kind={kind}
					habits={habits}
					onPick={onPick}
					empty={
						<Card padding={4}>
							<View style={styles.empty}>
								<Text variant="h3" align="center">
									{t.t(reason ?? "journal.needsHabit")}
								</Text>
								<Text tone="muted" align="center">
									{t.t("journal.noEligibleHabit")}
								</Text>
								<Button
									label={t.t("habits.new")}
									icon={Plus}
									onPress={() => router.push("/habit/editor")}
									style={styles.emptyAction}
									testID="journal-new-habit"
								/>
							</View>
						</Card>
					}
				/>
				{onBack ? (
					<Button
						label={t.t("common.back")}
						variant="ghost"
						onPress={onBack}
						style={styles.back}
						testID="journal-habit-back"
					/>
				) : null}
			</View>
		</Screen>
	);
}

function NewEntryEditor({
	kind,
	params,
	habit,
	onChangeHabit,
}: {
	kind: JournalKind;
	params: NewEntryParams;
	habit: Habit | undefined;
	onChangeHabit?: (habitId: string) => void;
}) {
	const t = useT();
	const text = useText();
	const today = useToday();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const identities = useIdentities();
	const trackers = useTrackerEntryIndex();
	// The draft is built once: prefills from the habit (its text in the content
	// language), the identity, the day and, after a slip, the slip's own note and cue.
	const [initial] = useState(() => {
		const identity = identities.find((item) => item.id === params.identityId);
		const day = params.date ?? today;
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
			date: params.date,
			scope: params.scope,
			prefill,
		});
	});
	return <JournalEditor initial={initial} onChangeHabit={onChangeHabit} />;
}

const useStyles = makeStyles(() => ({
	eyebrow: { marginBottom: 2 },
	empty: { alignItems: "center", gap: 8, paddingVertical: 24, paddingHorizontal: 16 },
	emptyAction: { marginTop: 10 },
	back: { alignSelf: "flex-start", marginTop: 20, marginLeft: -12 },
}));
