import { Plus, X } from "@/components/icons";
import { RepeatChip } from "@/components/tasks/repeat-field";
import { IconButton } from "@/components/ui/icon-button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles, useTheme } from "@/lib/theme";
import type { RepeatRule, SetupTaskDraft, TaskLaw } from "@atomic/core";
import { useAtomic, useToday } from "@atomic/core/react";
import { useEffect, useRef } from "react";
import { Platform, type TextInput, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import type { SetupDraftFields, SetupDraftUpdate } from "./setup-draft";
import {
	defaultSetupRepeat,
	lawName,
	newSetupDraft,
	sameRule,
	useSameDaysPreset,
} from "./setup-shared";

/** The web preview keeps a one-line input (its textarea doesn't grow). */
const WRAP = Platform.OS !== "web";

export interface SetupTaskAdderProps {
	/** The law the free-form tasks it adds belong to. */
	law: TaskLaw;
	draft: SetupDraftFields;
	update: SetupDraftUpdate;
}

/**
 * "+ Add setup task · {law}" at the bottom of a law step (Annex T §5.4, as
 * amended by D15: every law, both kinds). Each row is a free-form draft
 * (`field: null`): a title input (`setup.titlePlaceholder[Break]`), a
 * compact repeat chip ("Same days as the habit" in its sheet; it follows
 * the title's wording until the user picks one) and a remove button. The
 * keyboard's return adds the next row; backspace on an empty row removes it.
 * Rows without a title are dropped on save.
 */
export function SetupTaskAdder({ law, draft, update }: SetupTaskAdderProps) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const today = useToday();
	const reduceMotion = useReduceMotion();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const rows = draft.setupTasks.filter((d) => d.field === null && d.law === law);
	const inputs = useRef(new Map<string, TextInput>());
	/** The row whose input takes focus after the next render. */
	const focusNext = useRef<string | null>(null);
	const isBreak = draft.kind === "break";
	const sameDays = useSameDaysPreset(draft, today);
	const lawLabel = lawName(law, draft.kind, t);

	useEffect(() => {
		const target = focusNext.current;
		if (!target) return;
		focusNext.current = null;
		// Next frame: the key that removed a row (backspace) must not land in its neighbour.
		requestAnimationFrame(() => inputs.current.get(target)?.focus());
	});

	const patch = (key: string, changes: Partial<SetupTaskDraft>) =>
		update({
			setupTasks: draft.setupTasks.map((d) => (d.key === key ? { ...d, ...changes } : d)),
		});

	const add = (after?: string) => {
		haptics.selection();
		const row = newSetupDraft({ field: null, law, title: "", repeat: null, date: today });
		const list = [...draft.setupTasks];
		const index = after ? list.findIndex((d) => d.key === after) : -1;
		list.splice(index >= 0 ? index + 1 : list.length, 0, row);
		focusNext.current = row.key;
		update({ setupTasks: list });
	};

	const remove = (key: string, focusNeighbour: boolean) => {
		const index = rows.findIndex((d) => d.key === key);
		const neighbour = rows[index - 1] ?? rows[index + 1];
		if (focusNeighbour && neighbour) focusNext.current = neighbour.key;
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
		<View style={styles.wrap} testID={`setup-adder-${law}`}>
			{rows.map((row) => (
				<Animated.View
					key={row.key}
					entering={reduceMotion ? undefined : FadeIn.duration(180)}
					exiting={reduceMotion ? undefined : FadeOut.duration(120)}
					layout={reduceMotion ? undefined : LinearTransition.duration(180)}
					style={styles.row}
				>
					<View style={styles.rowTop}>
						<TextField
							ref={(node) => {
								if (node) inputs.current.set(row.key, node);
								else inputs.current.delete(row.key);
							}}
							value={row.title ?? ""}
							onChangeText={(title) => rename(row, title)}
							placeholder={t.t(isBreak ? "setup.titlePlaceholderBreak" : "setup.titlePlaceholder")}
							accessibilityLabel={`${t.t("setup.titleLabel")} · ${lawLabel}`}
							maxLength={280}
							// Long titles wrap on phones; return still adds the next row.
							multiline={WRAP}
							style={WRAP ? styles.inputText : undefined}
							returnKeyType="next"
							submitBehavior="submit"
							onSubmitEditing={() => {
								if (row.title?.trim()) add(row.key);
							}}
							onKeyPress={(event) => {
								if (event.nativeEvent.key === "Backspace" && !row.title) remove(row.key, true);
							}}
							containerStyle={styles.input}
							testID={`setup-row-input-${law}`}
						/>
						<IconButton
							icon={X}
							size={36}
							iconSize={18}
							color={colors.textMuted}
							accessibilityLabel={
								row.title?.trim()
									? `${t.t("setup.remove")}: ${row.title.trim()}`
									: t.t("setup.remove")
							}
							onPress={() => {
								haptics.selection();
								remove(row.key, false);
							}}
							style={styles.remove}
							testID={`setup-row-remove-${law}`}
						/>
					</View>
					<RepeatChip
						value={row.repeat}
						onChange={(repeat) => setRepeat(row, repeat)}
						start={row.date}
						weekStartsOn={weekStartsOn}
						extra={row.date === today ? sameDays : undefined}
						noneLabel={t.t("repeat.once")}
						size="sm"
					/>
				</Animated.View>
			))}
			<PressableScale
				onPress={() => add()}
				scaleTo={0.97}
				accessibilityRole="button"
				accessibilityLabel={`${t.t("setup.add")} · ${lawLabel}`}
				style={styles.add}
				testID={`setup-add-${law}`}
			>
				<View style={styles.plus}>
					<Plus size={14} color={colors.text} strokeWidth={2.4} />
				</View>
				<Text variant="small" weight="semibold" style={styles.addText}>
					{t.t("setup.add")}
					<Text variant="small" tone="muted">
						{` · ${lawLabel}`}
					</Text>
				</Text>
			</PressableScale>
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	wrap: { gap: 10 },
	row: {
		gap: 8,
		padding: 10,
		paddingRight: 6,
		borderRadius: t.radii.md,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
	rowTop: { flexDirection: "row", alignItems: "center", gap: 4 },
	input: { flex: 1 },
	inputText: { minHeight: 0 },
	remove: { marginLeft: 2 },
	add: {
		flexDirection: "row",
		alignItems: "center",
		alignSelf: "flex-start",
		maxWidth: "100%",
		gap: 10,
		minHeight: 44,
		paddingVertical: 8,
		paddingLeft: 6,
		paddingRight: 12,
		marginLeft: -6,
		borderRadius: t.radii.md,
	},
	plus: {
		width: 24,
		height: 24,
		borderRadius: 12,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: t.colors.sunken,
	},
	addText: { flexShrink: 1 },
}));
