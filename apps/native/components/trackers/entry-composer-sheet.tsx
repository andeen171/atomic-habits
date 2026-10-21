import { ChevronDown, ImageOff, Trash2 } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { type EntryComposerTarget, showToast, ui, useUI } from "@/lib/ui-store";
import {
	type AtomicState,
	type EntryType,
	type FieldSpec,
	type FormValue,
	type FormValues,
	type Habit,
	type TrackerEntry,
	entryMoment,
	entryTypeLabel,
	formToData,
	isEntryType,
	knownTracker,
	parseDecimalInput,
	suggestCategory,
	trackerDayLine,
	trackerDef,
	trackerEntryIndexOf,
} from "@atomic/core";
import {
	type TrackerInfo,
	useActions,
	useAtomicStore,
	useBooks,
	useDayTrackerEntries,
	useEntryForm,
	useHabit,
	useText,
	useToday,
	useTracker,
	useTrackerEntry,
	useTrackerEntryIndex,
} from "@atomic/core/react";
import { router, usePathname } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { type TextInput, View } from "react-native";
import { BookSheet } from "./book-sheet";
import { trackerCaps } from "./caps";
import { FieldRenderer, isTypingField } from "./fields";
import { TrackerSheetsHost } from "./tracker-sheets";
import { trackerUI, useTrackerUI } from "./tracker-ui";
import { useNothingToLog } from "./use-nothing-to-log";

/**
 * The global tracker entry composer (Annex K §5.1), mounted once in
 * `GlobalSheets` and opened with `ui.openEntryComposer({ habitId, day,
 * entryId?, type? })`. A bottom sheet whose form is rendered from core's
 * declarative field specs; core parses and validates every value
 * (`formToData`), so web and native store the same thing. Haptics: light on
 * save, warning on errors; Delete shows an Undo toast. Also hosts the tracker
 * sheets opened from menus (`TrackerSheetsHost`). Owner: T4.
 */
export function EntryComposerSheet() {
	const target = useUI((s) => s.entryComposer);
	const store = useAtomicStore();
	// One session per opening: a fresh form each time (never the last one's typing), kept
	// while the sheet animates out.
	const [session, setSession] = useState<ComposerSession | null>(null);
	if (target && target !== session?.source) {
		setSession({
			source: target,
			target: resolveTarget(target, store.getState()),
			id: (session?.id ?? 0) + 1,
			round: 0,
		});
	}
	// A prefill ("Log a connection with Grandma") is for this opening only: the form has
	// read it while rendering, before this runs.
	const sessionId = session?.id;
	useEffect(() => {
		if (sessionId !== undefined) trackerUI.clearPrefill();
	}, [sessionId]);
	// Leaving the screen (a toast's "Reflect", a notification) closes the composer.
	const pathname = usePathname();
	const lastPath = useRef(pathname);
	useEffect(() => {
		if (lastPath.current === pathname) return;
		lastPath.current = pathname;
		if (useUI.getState().entryComposer) ui.closeEntryComposer();
	}, [pathname]);
	return (
		<>
			{session ? (
				<ComposerSheet
					key={session.id}
					target={session.target}
					open={target !== null}
					round={session.round}
					onAgain={() =>
						setSession((current) => current && { ...current, round: current.round + 1 })
					}
				/>
			) : null}
			<TrackerSheetsHost />
		</>
	);
}

interface ComposerSession {
	/** The target as opened (a new object for each opening). */
	source: EntryComposerTarget;
	target: EntryComposerTarget;
	id: number;
	/** "Save & add another" rounds within this opening. */
	round: number;
}

/**
 * One wake-up, bedtime or plan per day: "Add" on a day that already has one
 * edits it, so a second save never replaces it (a plan would drop its open
 * tasks). Resolved once per opening, so the form doesn't turn into "Edit"
 * while it closes after saving.
 */
function resolveTarget(target: EntryComposerTarget, state: AtomicState): EntryComposerTarget {
	if (target.entryId) return target;
	const habit = state.data.habits[target.habitId];
	const config = habit ? knownTracker(habit) : null;
	const def = config ? trackerDef(config.type) : undefined;
	if (!def) return target;
	const type = target.type ?? def.primaryType;
	if (type === "none" || !def.uniquePerDay.includes(type)) return target;
	const existing = trackerEntryIndexOf(state.data.trackerEntries)
		.byHabitDay.get(target.habitId)
		?.get(target.day)
		?.find((e) => e.type === type);
	return existing ? { ...target, entryId: existing.id } : target;
}

interface ComposerSheetProps {
	target: EntryComposerTarget;
	open: boolean;
	round: number;
	/** "Save & add another": a fresh form for the same day. */
	onAgain(): void;
}

function ComposerSheet({ target, open, round, onAgain }: ComposerSheetProps) {
	const t = useT();
	const habit = useHabit(target.habitId);
	const tracker = useTracker(habit);
	const entry = useTrackerEntry(target.entryId);
	const close = ui.closeEntryComposer;

	const notice = (title: string, body: string) => (
		<Sheet
			open={open}
			onClose={close}
			title={title}
			testID="entry-composer"
			footer={
				<Button
					label={t.t("common.close")}
					variant="secondary"
					size="lg"
					fullWidth
					onPress={close}
				/>
			}
		>
			<Text tone="muted" style={{ paddingBottom: 8 }}>
				{body}
			</Text>
		</Sheet>
	);

	if (!habit || !tracker || !tracker.active || habit.archivedAt) {
		return notice(habit?.name ?? t.t("tracker.entry"), t.t("tracker.readOnly"));
	}
	if (target.entryId && (!entry || entry.deletedAt)) {
		return notice(habit.name, t.t("tracker.entryGone"));
	}
	const type: EntryType =
		entry && isEntryType(entry.type)
			? entry.type
			: target.type && tracker.def.entryTypes.includes(target.type)
				? target.type
				: tracker.def.primaryType;
	return (
		<ComposerForm
			habit={habit}
			tracker={tracker}
			type={type}
			target={target}
			entry={entry && !entry.deletedAt ? entry : undefined}
			open={open}
			round={round}
			onAgain={onAgain}
		/>
	);
}

interface ComposerFormProps extends ComposerSheetProps {
	habit: Habit;
	tracker: TrackerInfo;
	type: EntryType;
	entry: TrackerEntry | undefined;
}

interface FormState {
	key: string;
	values: FormValues;
	errors: Record<string, string>;
	categoryTouched: boolean;
	showMore: boolean;
	markFinished: boolean;
}

function ComposerForm({
	habit,
	tracker,
	type,
	target,
	entry,
	open,
	round,
	onAgain,
}: ComposerFormProps) {
	const t = useT();
	const text = useText();
	const actions = useActions();
	const store = useAtomicStore();
	const today = useToday();
	const index = useTrackerEntryIndex();
	const { habit: toneOf } = useTheme();
	const styles = useStyles();
	const caps = useMemo(() => trackerCaps(), []);
	const { specs, initial } = useEntryForm(habit, type, target.day, entry?.id, caps);
	const books = useBooks(type === "reading" ? habit.id : undefined);
	const dayEntries = useDayTrackerEntries(habit.id, target.day);
	const markNothing = useNothingToLog();
	const [bookOpen, setBookOpen] = useState(false);
	// Photos still being prepared: saving now would drop them.
	const [photosBusy, setPhotosBusy] = useState(false);
	const firstInput = useRef<TextInput>(null);
	// Opened to add last night's wake-up ("How did you sleep?"): the wake-up and quality lead.
	const wakeFirst =
		type === "sleep" &&
		!!entry &&
		typeof entry.data.wake !== "number" &&
		specs.some((spec) => spec.key === "wake");
	const primary = specs
		.filter((spec) => spec.section === "primary")
		.sort((a, b) => (wakeFirst ? wakeRank(a) - wakeRank(b) : 0));
	const more = specs.filter((spec) => spec.section === "more");
	// A prefill for this habit ("Log a connection with Grandma") fills its fields on top.
	const [prefill] = useState(() => {
		const pending = useTrackerUI.getState().prefill;
		return !entry && pending?.habitId === habit.id ? pending.values : null;
	});

	// The form starts from a snapshot per opening: later store changes never overwrite typing.
	const formKey = `${target.habitId}:${target.day}:${entry?.id ?? ""}:${type}:${round}`;
	const fresh = (): FormState => ({
		key: formKey,
		values: prefill && round === 0 ? { ...initial, ...prefill } : initial,
		errors: {},
		categoryTouched: !!entry,
		showMore: !!entry && more.some((spec) => hasValue(initial[spec.key])),
		markFinished: true,
	});
	const [form, setForm] = useState<FormState>(fresh);
	const current = form.key === formKey ? form : fresh();
	if (form.key !== formKey) setForm(current);
	const { values, errors } = current;

	const editing = !!entry;
	const isExpense = type === "expense";
	const isSlip = type === "slip";

	// Typing fields lead the form: focus them once the sheet is up (and again after "add another").
	// biome-ignore lint/correctness/useExhaustiveDependencies: on each opening only.
	useEffect(() => {
		const lead = primary[0];
		// A prefilled lead field (the person to call) is done: the next choice is a tap away.
		if (!open || editing || !lead || !isTypingField(lead) || hasValue(values[lead.key])) return;
		const id = setTimeout(() => firstInput.current?.focus(), round > 0 ? 60 : 340);
		return () => clearTimeout(id);
	}, [open, formKey]);

	const name = text.habit(habit, "name");
	const tone = toneOf(habit.color);
	const liveExpenses = dayEntries.some((e) => e.type === "expense");
	const canNoSpend =
		!editing && isExpense && tracker.def.allowsNone && !liveExpenses && target.day <= today;
	const subtitle = [
		editing ? t.t("tracker.editEntry") : entryTypeLabel(type, t),
		t.formatRelativeDay(target.day, today),
	]
		.filter(Boolean)
		.join(" · ");

	// Reading: reaching the book's last page offers to mark it finished (Annex K §1.8.2).
	const finishing = (() => {
		if (type !== "reading") return null;
		const bookId = typeof values.bookId === "string" ? values.bookId : null;
		const book = bookId ? books.find((b) => b.id === bookId) : undefined;
		if (!book || book.status === "finished" || !book.pages) return null;
		const toPage = parseDecimalInput(typeof values.toPage === "string" ? values.toPage : "");
		const pages = parseDecimalInput(typeof values.pages === "string" ? values.pages : "") ?? 0;
		const reached = (toPage ?? book.page + pages) >= book.pages;
		return reached && (toPage !== null || pages > 0) ? book : null;
	})();

	const patch = (next: Partial<FormState>) => setForm({ ...current, ...next });

	const setValue = (spec: FieldSpec, value: FormValue) => {
		const nextValues = { ...values, [spec.key]: value };
		// The category follows the note until the user picks one (Annex K §1.8.1).
		if (isExpense && spec.key === "note" && !current.categoryTouched && typeof value === "string") {
			const suggested = suggestCategory(value, index, habit.id);
			if (suggested) nextValues.category = suggested;
		}
		const { [spec.key]: _, ...restErrors } = errors;
		patch({
			values: nextValues,
			errors: errors[spec.key] ? restErrors : errors,
			categoryTouched: current.categoryTouched || (isExpense && spec.key === "category"),
		});
	};

	const dayLineAfter = () => {
		const latest = store.getState();
		const freshHabit = latest.data.habits[habit.id] ?? habit;
		return trackerDayLine(
			freshHabit,
			trackerEntryIndexOf(latest.data.trackerEntries),
			target.day,
			today,
			t,
		);
	};

	const afterSave = (saved: TrackerEntry, again: boolean) => {
		haptics.light();
		if (finishing && current.markFinished) {
			actions.updateTrackerEntry(finishing.id, {
				data: { status: "finished", finishedOn: target.day },
			});
			haptics.success();
		}
		const line = dayLineAfter();
		if (saved.type === "slip") {
			showToast(t.t("habit.slipLogged"), {
				duration: 6000,
				action: {
					label: t.t("tracker.reflect"),
					onPress: () =>
						router.push({
							pathname: "/journal/editor",
							params: { kind: "recovery", habitId: habit.id, date: target.day },
						}),
				},
			});
		} else if (finishing && current.markFinished) {
			showToast(t.t("tracker.reading.finishedToast", { title: finishing.title }), {
				tone: "success",
				action: { label: t.t("common.undo"), onPress: () => actions.deleteTrackerEntry(saved.id) },
			});
		} else if (editing) {
			showToast(line ? `${t.t("common.saved")} · ${line}` : t.t("common.saved"), {
				tone: "success",
			});
		} else {
			showToast(line ? `${t.t("tracker.entrySaved")} · ${line}` : t.t("tracker.entrySaved"), {
				tone: "success",
				action: { label: t.t("common.undo"), onPress: () => actions.deleteTrackerEntry(saved.id) },
			});
		}
		if (again) onAgain();
		else ui.closeEntryComposer();
	};

	const save = (again: boolean) => {
		if (photosBusy) return;
		const result = formToData(specs, values, t);
		if (!result.ok) {
			haptics.warning();
			const firstBad = specs.find((spec) => result.errors[spec.key]);
			patch({
				errors: result.errors,
				showMore: current.showMore || (!!firstBad && more.includes(firstBad)),
			});
			return;
		}
		const saved = entry
			? actions.updateTrackerEntry(entry.id, { data: result.data })
			: actions.addTrackerEntry({
					habitId: habit.id,
					date: target.day,
					type,
					at: entryMoment(target.day, today, Date.now()),
					data: result.data,
				});
		if (!saved) {
			haptics.warning();
			showToast(t.t("tracker.saveFailed"), { tone: "danger" });
			return;
		}
		afterSave(saved, again);
	};

	const justLog = () => {
		const saved = actions.addTrackerEntry({
			habitId: habit.id,
			date: target.day,
			type: "slip",
			at: entryMoment(target.day, today, Date.now()),
			data: {},
		});
		if (!saved) {
			haptics.warning();
			showToast(t.t("tracker.saveFailed"), { tone: "danger" });
			return;
		}
		afterSave(saved, false);
	};

	const remove = () => {
		if (!entry) return;
		actions.deleteTrackerEntry(entry.id);
		haptics.medium();
		showToast(t.t("tracker.entryDeleted"), {
			action: { label: t.t("common.undo"), onPress: () => actions.restoreTrackerEntry(entry.id) },
		});
		ui.closeEntryComposer();
	};

	// "I'm on page": the chosen book's bookmark as the hint ("150"), so the next number is obvious.
	const bookmark = (() => {
		if (type !== "reading" || typeof values.bookId !== "string") return null;
		const book = books.find((b) => b.id === values.bookId);
		return book && book.page > 0 && book.status !== "finished" ? book.page : null;
	})();
	// The tracker needs a photo and there are no photos here: nothing to fill in.
	const blocked = specs.length === 0 && type === "photo";
	const field = (spec: FieldSpec, i: number) => (
		<FieldRenderer
			key={spec.key}
			hero={type === "measure" && spec.key === "value"}
			day={target.day}
			onBusyChange={spec.kind === "photos" ? setPhotosBusy : undefined}
			spec={
				spec.key === "toPage" && spec.kind === "number" && bookmark !== null
					? { ...spec, placeholder: t.number(bookmark) }
					: spec
			}
			value={values[spec.key]}
			onChange={(value) => setValue(spec, value)}
			error={errors[spec.key]}
			books={books}
			onNewBook={() => setBookOpen(true)}
			inputRef={i === 0 && spec.section === "primary" ? firstInput : undefined}
			onSubmit={() => save(false)}
		/>
	);

	const secondary = !editing
		? isExpense
			? { label: t.t("tracker.saveAndAdd"), run: () => save(true) }
			: isSlip
				? { label: t.t("tracker.slip.justLog"), run: justLog }
				: null
		: null;

	return (
		<Sheet
			open={open}
			onClose={ui.closeEntryComposer}
			title={name}
			subtitle={subtitle}
			scroll
			closeButton
			testID="entry-composer"
			leading={
				<View style={[styles.emojiTile, { backgroundColor: tone.soft }]}>
					<Text style={styles.emoji} allowFontScaling={false}>
						{habit.emoji}
					</Text>
				</View>
			}
			footer={
				<View style={styles.footer}>
					{editing ? (
						<IconButton
							icon={Trash2}
							variant="soft"
							size={46}
							color={styles.danger.color}
							accessibilityLabel={t.t("tracker.deleteEntry")}
							onPress={remove}
							testID="entry-delete"
						/>
					) : null}
					{secondary ? (
						<Button
							label={secondary.label}
							variant="secondary"
							size="lg"
							disabled={photosBusy || blocked}
							onPress={secondary.run}
							style={styles.footerButton}
							testID="entry-secondary"
						/>
					) : null}
					<Button
						label={photosBusy ? t.t("tracker.photo.preparing") : t.t("tracker.save")}
						size="lg"
						disabled={photosBusy || blocked}
						onPress={() => save(false)}
						style={styles.footerButton}
						testID="entry-save"
					/>
				</View>
			}
		>
			<View style={styles.body}>
				{blocked ? (
					<View style={styles.blocked}>
						<ImageOff size={16} color={styles.muted.color} style={styles.blockedIcon} />
						<Text variant="small" tone="muted" style={styles.grow}>
							{t.t("tracker.photo.requiredOff")}
						</Text>
					</View>
				) : null}
				{primary.map(field)}
				{finishing ? (
					<View style={styles.finishing}>
						<Text weight="medium" variant="small" style={styles.grow}>
							{t.t("tracker.reading.finishedPrompt", { title: finishing.title })}
						</Text>
						<Switch
							value={current.markFinished}
							onValueChange={(markFinished) => patch({ markFinished })}
							accessibilityLabel={t.t("tracker.reading.markFinished")}
						/>
					</View>
				) : null}
				{more.length ? (
					<View style={styles.more}>
						<PressableScale
							onPress={() => {
								haptics.selection();
								patch({ showMore: !current.showMore });
							}}
							accessibilityRole="button"
							accessibilityState={{ expanded: current.showMore }}
							accessibilityLabel={t.t("tracker.moreDetails")}
							hitSlop={6}
							style={styles.moreToggle}
							testID="entry-more"
						>
							<View style={current.showMore ? styles.flip : undefined}>
								<ChevronDown size={16} color={styles.muted.color} />
							</View>
							<Text variant="small" weight="medium" tone="muted">
								{t.t("tracker.moreDetails")}
							</Text>
						</PressableScale>
						{current.showMore ? <View style={styles.body}>{more.map(field)}</View> : null}
					</View>
				) : null}
				{canNoSpend ? (
					<View style={styles.noSpend}>
						<View
							style={styles.orRow}
							accessibilityElementsHidden
							importantForAccessibility="no-hide-descendants"
						>
							<View style={styles.rule} />
							<Text variant="tiny" tone="subtle">
								{t.t("tracker.or")}
							</Text>
							<View style={styles.rule} />
						</View>
						<Button
							label={
								target.day === today
									? t.t("tracker.expense.noSpend")
									: t.t("tracker.expense.noSpendDay")
							}
							variant="soft"
							fullWidth
							onPress={() => {
								if (markNothing(habit, target.day)) ui.closeEntryComposer();
							}}
							testID="entry-no-spend"
						/>
					</View>
				) : null}
			</View>
			{type === "reading" ? (
				<BookSheet
					habit={habit}
					open={bookOpen}
					onClose={() => setBookOpen(false)}
					onSaved={(id) => patch({ values: { ...values, bookId: id } })}
				/>
			) : null}
		</Sheet>
	);
}

/** Sleep fields when adding the wake-up: woke up, how it went, then the bedtime. */
function wakeRank(spec: FieldSpec): number {
	return spec.key === "wake" ? 0 : spec.key === "quality" ? 1 : 2;
}

function hasValue(value: FormValue | undefined): boolean {
	if (value === null || value === undefined) return false;
	if (typeof value === "string") return value.trim().length > 0;
	if (Array.isArray(value)) return value.length > 0;
	return true;
}

const useStyles = makeStyles((t) => ({
	emojiTile: {
		width: 44,
		height: 44,
		borderRadius: 14,
		alignItems: "center",
		justifyContent: "center",
	},
	emoji: { fontSize: 22, lineHeight: 28 },
	body: { gap: 20 },
	grow: { flex: 1 },
	footer: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
	footerButton: { flexGrow: 1, flexBasis: "auto" },
	danger: { color: t.colors.danger },
	muted: { color: t.colors.textMuted },
	finishing: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		paddingHorizontal: 14,
		paddingVertical: 12,
		borderRadius: t.radii.md,
		backgroundColor: t.colors.accentSoft,
	},
	more: { gap: 16 },
	blocked: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 10,
		paddingHorizontal: 14,
		paddingVertical: 12,
		borderRadius: t.radii.md,
		backgroundColor: t.colors.sunken,
	},
	blockedIcon: { marginTop: 1 },
	moreToggle: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		alignSelf: "flex-start",
		minHeight: 36,
		paddingHorizontal: 8,
		marginLeft: -8,
		borderRadius: 999,
	},
	flip: { transform: [{ rotate: "180deg" }] },
	noSpend: { gap: 12 },
	orRow: { flexDirection: "row", alignItems: "center", gap: 10 },
	rule: { flex: 1, height: 1, backgroundColor: t.colors.border },
}));
