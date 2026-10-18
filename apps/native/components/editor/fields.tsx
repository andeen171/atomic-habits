import { Check, Clock, Minus, Plus, ShieldOff, Sprout, X } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Stepper } from "@/components/ui/stepper";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	EMOJI_CHOICES,
	HABIT_COLORS,
	type HabitColor,
	type HabitKind,
	type HabitTemplate,
	type Identity,
	type Schedule,
	TIMES_OF_DAY,
	type TimeOfDay,
	type Weekday,
	orderedWeekdays,
} from "@atomic/core";
import { useAtomic } from "@atomic/core/react";
import { type ReactNode, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

/** Label + optional hint above a control. */
export function Field({
	label,
	hint,
	children,
}: { label: string; hint?: string; children: ReactNode }) {
	return (
		<View style={{ gap: 8 }}>
			<View style={{ gap: 2 }}>
				<Text variant="small" weight="semibold">
					{label}
				</Text>
				{hint ? (
					<Text variant="small" tone="muted">
						{hint}
					</Text>
				) : null}
			</View>
			{children}
		</View>
	);
}

export function KindToggle({
	value,
	onChange,
}: { value: HabitKind; onChange: (kind: HabitKind) => void }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const options: { kind: HabitKind; icon: typeof Sprout }[] = [
		{ kind: "build", icon: Sprout },
		{ kind: "break", icon: ShieldOff },
	];
	return (
		<View
			style={styles.kindRow}
			accessibilityRole="radiogroup"
			accessibilityLabel={t.t("form.kind")}
		>
			{options.map(({ kind, icon: Icon }) => {
				const selected = value === kind;
				return (
					<PressableScale
						key={kind}
						testID={`kind-${kind}`}
						scaleTo={0.97}
						onPress={() => {
							haptics.selection();
							onChange(kind);
						}}
						accessibilityRole="radio"
						accessibilityState={{ selected }}
						style={[
							styles.kind,
							selected && { borderColor: colors.text, backgroundColor: colors.surface },
						]}
					>
						<View
							style={[styles.kindIcon, { backgroundColor: selected ? colors.text : colors.sunken }]}
						>
							<Icon size={18} color={selected ? colors.bg : colors.textMuted} strokeWidth={2} />
						</View>
						<Text weight="semibold">{t.t(`form.kind.${kind}`)}</Text>
						<Text variant="small" tone="muted">
							{t.t(kind === "build" ? "form.kind.buildHint" : "form.kind.breakHint")}
						</Text>
					</PressableScale>
				);
			})}
		</View>
	);
}

/** Read-only kind for existing habits: past logs mean different things for build and break. */
export function KindSummary({ value }: { value: HabitKind }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const Icon = value === "build" ? Sprout : ShieldOff;
	return (
		<View
			testID="kind-summary"
			accessible
			accessibilityLabel={`${t.t("form.kind")}: ${t.t(`form.kind.${value}`)}`}
			style={styles.kindSummary}
		>
			<View style={[styles.kindIcon, styles.kindSummaryIcon, { backgroundColor: colors.sunken }]}>
				<Icon size={18} color={colors.textMuted} strokeWidth={2} />
			</View>
			<View style={{ flex: 1, gap: 2 }}>
				<Text weight="semibold">{t.t(`form.kind.${value}`)}</Text>
				<Text variant="small" tone="muted">
					{t.t(value === "build" ? "form.kind.buildHint" : "form.kind.breakHint")}
				</Text>
			</View>
		</View>
	);
}

export function EmojiPicker({
	value,
	onChange,
}: { value: string; onChange: (emoji: string) => void }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const [expanded, setExpanded] = useState(false);
	const choices: string[] = [...EMOJI_CHOICES];
	if (!choices.includes(value)) choices.unshift(value);
	const shown = expanded ? choices : choices.slice(0, 15);
	return (
		<View
			style={styles.emojiGrid}
			accessibilityRole="radiogroup"
			accessibilityLabel={t.t("form.emoji")}
		>
			{shown.map((emoji) => {
				const selected = emoji === value;
				return (
					<Pressable
						key={emoji}
						onPress={() => {
							haptics.selection();
							onChange(emoji);
						}}
						accessibilityRole="radio"
						accessibilityState={{ selected }}
						accessibilityLabel={emoji}
						style={[
							styles.emojiCell,
							selected && { backgroundColor: colors.surface, borderColor: colors.text },
						]}
					>
						<Text style={styles.emoji} allowFontScaling={false}>
							{emoji}
						</Text>
					</Pressable>
				);
			})}
			<Pressable
				onPress={() => setExpanded((v) => !v)}
				accessibilityRole="button"
				accessibilityLabel={t.t("common.more")}
				style={[styles.emojiCell, styles.emojiMore]}
			>
				{expanded ? (
					<Minus size={18} color={colors.textMuted} />
				) : (
					<Plus size={18} color={colors.textMuted} />
				)}
			</Pressable>
		</View>
	);
}

export function ColorPicker({
	value,
	onChange,
}: { value: HabitColor; onChange: (color: HabitColor) => void }) {
	const t = useT();
	const { habit: toneOf } = useTheme();
	const styles = useStyles();
	return (
		<View
			style={styles.colors}
			accessibilityRole="radiogroup"
			accessibilityLabel={t.t("form.color")}
		>
			{HABIT_COLORS.map((color) => {
				const selected = color === value;
				const tone = toneOf(color);
				return (
					<Pressable
						key={color}
						onPress={() => {
							haptics.selection();
							onChange(color);
						}}
						hitSlop={4}
						accessibilityRole="radio"
						accessibilityState={{ selected }}
						accessibilityLabel={t.x(`color.${color}`)}
						style={[styles.swatchRing, selected && { borderColor: tone.fill }]}
					>
						<View style={[styles.swatch, { backgroundColor: tone.fill }]}>
							{selected ? <Check size={14} color={tone.on} strokeWidth={3} /> : null}
						</View>
					</Pressable>
				);
			})}
		</View>
	);
}

export function TemplatePicker({
	templates,
	onPick,
}: {
	templates: HabitTemplate[];
	onPick: (template: HabitTemplate) => void;
}) {
	const { habit: toneOf } = useTheme();
	const styles = useStyles();
	return (
		<ScrollView
			horizontal
			showsHorizontalScrollIndicator={false}
			contentContainerStyle={styles.templates}
		>
			{templates.map((template) => {
				const tone = toneOf(template.color);
				return (
					<PressableScale
						key={template.key}
						testID={`template-${template.key}`}
						scaleTo={0.96}
						onPress={() => {
							haptics.selection();
							onPick(template);
						}}
						accessibilityRole="button"
						accessibilityLabel={template.name}
						style={styles.template}
					>
						<View style={[styles.templateEmoji, { backgroundColor: tone.soft }]}>
							<Text style={{ fontSize: 20, lineHeight: 26 }} allowFontScaling={false}>
								{template.emoji}
							</Text>
						</View>
						<Text variant="small" weight="semibold" numberOfLines={2}>
							{template.name}
						</Text>
						{template.twoMinute ? (
							<Text variant="tiny" tone="muted" italic numberOfLines={2}>
								{template.twoMinute}
							</Text>
						) : null}
					</PressableScale>
				);
			})}
		</ScrollView>
	);
}

export type IdentityChoice =
	| { mode: "none" }
	| { mode: "existing"; id: string }
	| { mode: "new"; statement: string };

export function IdentityPicker({
	identities,
	value,
	onChange,
}: {
	identities: Identity[];
	value: IdentityChoice;
	onChange: (choice: IdentityChoice) => void;
}) {
	const t = useT();
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const row = (
		key: string,
		selected: boolean,
		onPress: () => void,
		leading: ReactNode,
		label: string,
	) => (
		<PressableScale
			key={key}
			scaleTo={0.98}
			onPress={() => {
				haptics.selection();
				onPress();
			}}
			accessibilityRole="radio"
			accessibilityState={{ selected }}
			accessibilityLabel={label}
			style={[styles.identity, selected && { borderColor: colors.text }]}
		>
			{leading}
			<Text weight="medium" style={{ flex: 1 }} numberOfLines={2}>
				{label}
			</Text>
			<View
				style={[
					styles.radio,
					selected && { borderColor: colors.text, backgroundColor: colors.text },
				]}
			>
				{selected ? <Check size={12} color={colors.bg} strokeWidth={3} /> : null}
			</View>
		</PressableScale>
	);
	return (
		<View style={{ gap: 8 }} accessibilityRole="radiogroup">
			{identities.map((identity) =>
				row(
					identity.id,
					value.mode === "existing" && value.id === identity.id,
					() => onChange({ mode: "existing", id: identity.id }),
					<View style={[styles.identityEmoji, { backgroundColor: toneOf(identity.color).soft }]}>
						<Text style={{ fontSize: 18, lineHeight: 24 }} allowFontScaling={false}>
							{identity.emoji}
						</Text>
					</View>,
					identity.statement,
				),
			)}
			{row(
				"new",
				value.mode === "new",
				() => onChange({ mode: "new", statement: value.mode === "new" ? value.statement : "" }),
				<View style={[styles.identityEmoji, { backgroundColor: colors.accentSoft }]}>
					<Plus size={18} color={colors.accent} />
				</View>,
				t.t("form.identityNew"),
			)}
			{value.mode === "new" ? (
				<TextField
					value={value.statement}
					onChangeText={(statement) => onChange({ mode: "new", statement })}
					placeholder={t.t("form.identityPlaceholder")}
					hint={t.x("editor.identityNewHint")}
					autoFocus
					maxLength={120}
				/>
			) : null}
			{row(
				"none",
				value.mode === "none",
				() => onChange({ mode: "none" }),
				<View style={[styles.identityEmoji, { backgroundColor: colors.sunken }]}>
					<X size={16} color={colors.textMuted} />
				</View>,
				t.t("form.identityNone"),
			)}
		</View>
	);
}

export function ScheduleField({
	value,
	onChange,
}: { value: Schedule; onChange: (schedule: Schedule) => void }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn) as Weekday;
	return (
		<View style={{ gap: 12 }}>
			<SegmentedControl<Schedule["type"]>
				value={value.type}
				onChange={(type) => {
					if (type === "daily") onChange({ type });
					else if (type === "weekdays") onChange({ type, days: [1, 2, 3, 4, 5] });
					else onChange({ type, times: 3 });
				}}
				segments={[
					{ value: "daily", label: t.t("form.schedule.daily") },
					{ value: "weekdays", label: t.t("form.schedule.weekdays") },
					{ value: "weekly", label: t.t("form.schedule.weekly") },
				]}
				accessibilityLabel={t.t("form.schedule")}
			/>
			{value.type === "weekdays" ? (
				<View style={styles.weekdays}>
					{orderedWeekdays(weekStartsOn).map((day) => {
						const selected = value.days.includes(day);
						return (
							<Pressable
								key={day}
								onPress={() => {
									haptics.selection();
									const days = selected
										? value.days.filter((d) => d !== day)
										: [...value.days, day].sort();
									if (days.length) onChange({ type: "weekdays", days });
								}}
								accessibilityRole="checkbox"
								accessibilityState={{ checked: selected }}
								accessibilityLabel={t.weekdayName(day, "long")}
								style={[
									styles.weekday,
									selected && { backgroundColor: colors.text, borderColor: colors.text },
								]}
							>
								<Text
									variant="small"
									weight="semibold"
									color={selected ? colors.bg : colors.textMuted}
								>
									{t.weekdayName(day, "min")}
								</Text>
							</Pressable>
						);
					})}
				</View>
			) : null}
			{value.type === "weekly" ? (
				<View style={styles.inlineRow}>
					<Text tone="muted">{t.tp("form.schedule.timesPerWeek", value.times)}</Text>
					<Stepper
						value={value.times}
						min={1}
						max={7}
						onChange={(times) => onChange({ type: "weekly", times })}
						accessibilityLabel={t.x("editor.perWeek")}
					/>
				</View>
			) : null}
		</View>
	);
}

export function TimeOfDayField({
	value,
	onChange,
}: { value: TimeOfDay; onChange: (value: TimeOfDay) => void }) {
	const t = useT();
	return (
		<SegmentedControl<TimeOfDay>
			value={value}
			onChange={onChange}
			size="sm"
			segments={TIMES_OF_DAY.map((time) => ({ value: time, label: t.t(`time.${time}`) }))}
			accessibilityLabel={t.t("form.timeOfDay")}
		/>
	);
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

/** "07:30" field that opens an hour/minute grid sheet. */
export function TimeField({
	value,
	onChange,
}: { value: string | null; onChange: (value: string | null) => void }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const [open, setOpen] = useState(false);
	const [hour, setHour] = useState(7);
	const [minute, setMinute] = useState(0);
	const show = () => {
		const [h, m] = (value ?? "07:00").split(":").map(Number);
		setHour(h ?? 7);
		setMinute(m ?? 0);
		setOpen(true);
	};
	return (
		<>
			<View style={styles.timeField}>
				<Pressable
					onPress={show}
					accessibilityRole="button"
					accessibilityLabel={`${t.t("form.cueTime")}: ${value ?? t.x("editor.noTime")}`}
					style={styles.timeMain}
					testID="time-field"
				>
					<Clock size={18} color={value ? colors.accent : colors.textSubtle} />
					<Text weight={value ? "semibold" : "regular"} tone={value ? "default" : "subtle"} tabular>
						{value ?? t.x("editor.noTime")}
					</Text>
				</Pressable>
				{value ? (
					<Pressable
						onPress={() => onChange(null)}
						hitSlop={10}
						style={styles.timeClear}
						accessibilityRole="button"
						accessibilityLabel={t.x("editor.clear")}
					>
						<X size={16} color={colors.textMuted} />
					</Pressable>
				) : null}
			</View>
			<Sheet
				open={open}
				onClose={() => setOpen(false)}
				title={t.x("editor.pickTime")}
				footer={
					<Button
						label={`${t.t("common.done")} · ${pad(hour)}:${pad(minute)}`}
						size="lg"
						onPress={() => {
							onChange(`${pad(hour)}:${pad(minute)}`);
							setOpen(false);
						}}
						testID="time-done"
					/>
				}
			>
				<Text variant="label" style={{ marginBottom: 8 }}>
					{t.x("editor.hour")}
				</Text>
				<View style={styles.timeGrid}>
					{HOURS.map((h) => (
						<TimeCell key={h} label={pad(h)} selected={h === hour} onPress={() => setHour(h)} />
					))}
				</View>
				<Text variant="label" style={{ marginBottom: 8, marginTop: 16 }}>
					{t.x("editor.minute")}
				</Text>
				<View style={[styles.timeGrid, { marginBottom: 8 }]}>
					{MINUTES.map((m) => (
						<TimeCell
							key={m}
							label={`:${pad(m)}`}
							selected={m === minute}
							onPress={() => setMinute(m)}
						/>
					))}
				</View>
			</Sheet>
		</>
	);
}

function TimeCell({
	label,
	selected,
	onPress,
}: { label: string; selected: boolean; onPress: () => void }) {
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<Pressable
			onPress={() => {
				haptics.selection();
				onPress();
			}}
			accessibilityRole="radio"
			accessibilityState={{ selected }}
			accessibilityLabel={label}
			style={[styles.timeCell, selected && { backgroundColor: colors.text }]}
		>
			<Text
				variant="small"
				weight={selected ? "bold" : "medium"}
				tabular
				color={selected ? colors.bg : colors.text}
			>
				{label}
			</Text>
		</Pressable>
	);
}

const useStyles = makeStyles((t) => ({
	kindRow: { flexDirection: "row", gap: 10 },
	kind: {
		flex: 1,
		gap: 4,
		padding: 14,
		borderRadius: t.radii.lg,
		borderWidth: 1.5,
		borderColor: t.colors.border,
		backgroundColor: t.colors.bg,
	},
	kindIcon: {
		width: 34,
		height: 34,
		borderRadius: 11,
		alignItems: "center",
		justifyContent: "center",
		marginBottom: 6,
	},
	kindSummary: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		padding: 14,
		borderRadius: t.radii.lg,
		borderWidth: 1.5,
		borderColor: t.colors.border,
		backgroundColor: t.colors.bg,
	},
	kindSummaryIcon: { marginBottom: 0 },
	emojiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
	emojiCell: {
		width: 42,
		height: 42,
		borderRadius: 12,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 1.5,
		borderColor: "transparent",
		backgroundColor: t.colors.sunken,
	},
	emojiMore: {
		backgroundColor: "transparent",
		borderColor: t.colors.border,
		borderStyle: "dashed",
	},
	emoji: { fontSize: 22, lineHeight: 28 },
	colors: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
	swatchRing: {
		width: 40,
		height: 40,
		borderRadius: 20,
		borderWidth: 2,
		borderColor: "transparent",
		alignItems: "center",
		justifyContent: "center",
	},
	swatch: {
		width: 30,
		height: 30,
		borderRadius: 15,
		alignItems: "center",
		justifyContent: "center",
	},
	templates: { gap: 10, paddingRight: 20 },
	template: {
		width: 148,
		padding: 12,
		gap: 6,
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
	templateEmoji: {
		width: 36,
		height: 36,
		borderRadius: 11,
		alignItems: "center",
		justifyContent: "center",
	},
	identity: {
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		padding: 12,
		borderRadius: t.radii.lg,
		borderWidth: 1.5,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
	identityEmoji: {
		width: 38,
		height: 38,
		borderRadius: 12,
		alignItems: "center",
		justifyContent: "center",
	},
	radio: {
		width: 22,
		height: 22,
		borderRadius: 11,
		borderWidth: 1.5,
		borderColor: t.colors.borderStrong,
		alignItems: "center",
		justifyContent: "center",
	},
	weekdays: { flexDirection: "row", justifyContent: "space-between", gap: 6 },
	weekday: {
		flex: 1,
		height: 42,
		borderRadius: 21,
		borderWidth: 1.5,
		borderColor: t.colors.border,
		alignItems: "center",
		justifyContent: "center",
	},
	inlineRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
	timeField: {
		flexDirection: "row",
		alignItems: "center",
		minHeight: 48,
		borderRadius: t.radii.md,
		backgroundColor: t.colors.sunken,
	},
	timeMain: {
		flex: 1,
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		minHeight: 48,
		paddingHorizontal: 14,
	},
	timeClear: { paddingHorizontal: 14, minHeight: 48, justifyContent: "center" },
	timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
	timeCell: {
		width: "15%",
		flexGrow: 1,
		height: 40,
		borderRadius: 10,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: t.colors.sunken,
	},
}));
