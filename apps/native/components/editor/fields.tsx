import { AiSuggestButton } from "@/components/ai/ai-suggest-button";
import {
	Check,
	ChevronDown,
	Clock,
	Fingerprint,
	Minus,
	Plus,
	RotateCcw,
	ShieldOff,
	Sprout,
	X,
} from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { TrackerBadge } from "@/components/trackers/tracker-badge";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { PressableScale } from "@/components/ui/pressable-scale";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SmartTextField } from "@/components/ui/smart-text-field";
import { Stepper } from "@/components/ui/stepper";
import { Text } from "@/components/ui/text";
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
	type IdentityTemplate,
	type Schedule,
	TIMES_OF_DAY,
	type TimeOfDay,
	type Weekday,
	identityTemplates,
	matchIdentityTemplate,
	orderedWeekdays,
} from "@atomic/core";
import { useAtomic, useText } from "@atomic/core/react";
import { type ReactNode, useMemo, useState } from "react";
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

/** A habit icon that follows its identity until the user picks one (Annex H §1.2, D12). */
export interface EmojiAuto {
	/** The icon is the automatic one right now. */
	on: boolean;
	/** The identity's emoji, or the kind default (🌱 / 🚫) without an identity. */
	source: "identity" | "default";
	/** What the automatic icon is. */
	emoji: string;
	/** Back to the automatic icon. */
	onReset: () => void;
}

export function EmojiPicker({
	value,
	onChange,
	auto,
	offer,
	label,
	initiallyExpanded = false,
}: {
	value: string;
	onChange: (emoji: string) => void;
	/** Habit editor only: the "Matches your identity" caption, or a reset to it. */
	auto?: EmojiAuto;
	/** An emoji offered as a one-tap "Use 📖" chip (the applied template's, D12). */
	offer?: { emoji: string; onUse: () => void } | null;
	/** The grid's accessible name (default "Icon"). */
	label?: string;
	/** Show every choice at once (inside a sheet). */
	initiallyExpanded?: boolean;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const [expanded, setExpanded] = useState(initiallyExpanded);
	const choices: string[] = [...EMOJI_CHOICES];
	if (!choices.includes(value)) choices.unshift(value);
	const shown = expanded ? choices : choices.slice(0, 15);
	const fromIdentity = auto?.source === "identity";
	const caption = auto?.on ? t.t(fromIdentity ? "form.emojiAuto" : "form.emojiAutoKind") : null;
	const CaptionIcon = fromIdentity ? Fingerprint : Check;
	return (
		<View style={{ gap: 10 }}>
			{auto || offer ? (
				<View style={styles.emojiSource}>
					{auto ? (
						auto.on ? (
							<View style={styles.emojiCaption} testID="emoji-auto-caption">
								<CaptionIcon size={14} color={colors.textMuted} strokeWidth={2} />
								<Text variant="small" tone="muted" style={{ flexShrink: 1 }}>
									{caption}
								</Text>
							</View>
						) : (
							<PressableScale
								scaleTo={0.97}
								hitSlop={4}
								onPress={() => {
									haptics.selection();
									auto.onReset();
								}}
								accessibilityRole="button"
								accessibilityLabel={`${t.t(
									fromIdentity ? "form.emojiUseIdentity" : "form.emojiUseDefault",
								)} ${auto.emoji}`}
								style={styles.emojiReset}
								testID="emoji-reset"
							>
								<RotateCcw size={14} color={colors.textMuted} strokeWidth={2} />
								<Text variant="small" weight="medium" style={{ flexShrink: 1 }}>
									{t.t(fromIdentity ? "form.emojiUseIdentity" : "form.emojiUseDefault")}
								</Text>
								<Text style={styles.emojiInline} allowFontScaling={false}>
									{auto.emoji}
								</Text>
							</PressableScale>
						)
					) : null}
					{offer ? (
						<Chip
							label={t.t("form.emojiUseTemplate", { emoji: offer.emoji })}
							onPress={() => {
								haptics.selection();
								offer.onUse();
							}}
							testID="emoji-use-template"
						/>
					) : null}
				</View>
			) : null}
			<View
				style={styles.emojiGrid}
				accessibilityRole="radiogroup"
				accessibilityLabel={`${label ?? t.t("form.emoji")}${caption ? ` · ${caption}` : ""}`}
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
							style={({ pressed }) => [
								styles.emojiCell,
								pressed && { backgroundColor: colors.hover },
								selected && { backgroundColor: colors.surface, borderColor: colors.text },
							]}
						>
							<Text style={styles.emoji} allowFontScaling={false}>
								{emoji}
							</Text>
						</Pressable>
					);
				})}
				{initiallyExpanded ? null : (
					<Pressable
						onPress={() => setExpanded((v) => !v)}
						accessibilityRole="button"
						accessibilityLabel={t.t("common.more")}
						accessibilityState={{ expanded }}
						style={[styles.emojiCell, styles.emojiMore]}
					>
						{expanded ? (
							<Minus size={18} color={colors.textMuted} />
						) : (
							<Plus size={18} color={colors.textMuted} />
						)}
					</Pressable>
				)}
			</View>
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
	selectedKey,
}: {
	templates: HabitTemplate[];
	onPick: (template: HabitTemplate) => void;
	/** The template applied last (outlined). */
	selectedKey?: string | null;
}) {
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	return (
		<ScrollView
			horizontal
			showsHorizontalScrollIndicator={false}
			contentContainerStyle={styles.templates}
		>
			{templates.map((template) => {
				const tone = toneOf(template.color);
				const selected = template.key === selectedKey;
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
						accessibilityState={{ selected }}
						accessibilityLabel={
							template.twoMinute ? `${template.name}. ${template.twoMinute}` : template.name
						}
						style={[styles.template, selected && { borderColor: colors.text }]}
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
						<TrackerBadge template={template} />
					</PressableScale>
				);
			})}
		</ScrollView>
	);
}

/**
 * Template ideas for the "what" step (Annex H §1.2): with an identity that
 * matches a template identity, its habits come first as "Ideas for
 * “{identity}”" and the rest fold under "More ideas"; otherwise the plain
 * "Need inspiration?" row of every template of the kind.
 */
export function TemplateIdeas({
	ideas,
	rest,
	identity,
	selectedKey,
	onPick,
}: {
	/** The matched identity's templates of the habit's kind. */
	ideas: HabitTemplate[];
	/** Every other template of the kind. */
	rest: HabitTemplate[];
	/** The linked identity's statement (as shown), when it matched a template identity. */
	identity: string | null;
	selectedKey?: string | null;
	onPick: (template: HabitTemplate) => void;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const [open, setOpen] = useState(false);
	if (!ideas.length && !rest.length) return null;
	if (!ideas.length || !identity) {
		return (
			<Field label={t.t("form.templates")} hint={t.t("form.templatesHint")}>
				<TemplatePicker templates={rest} onPick={onPick} selectedKey={selectedKey} />
			</Field>
		);
	}
	return (
		<View style={{ gap: 8 }} testID="template-ideas">
			<Field label={t.t("form.templatesFor", { identity })} hint={t.t("form.templatesHint")}>
				<TemplatePicker templates={ideas} onPick={onPick} selectedKey={selectedKey} />
			</Field>
			{rest.length ? (
				<>
					<Pressable
						onPress={() => {
							haptics.selection();
							setOpen((value) => !value);
						}}
						accessibilityRole="button"
						accessibilityState={{ expanded: open }}
						accessibilityLabel={`${t.t("form.templatesMore")}, ${t.number(rest.length)}`}
						style={({ pressed }) => [styles.moreIdeas, pressed && { opacity: 0.6 }]}
						testID="template-more"
					>
						<ChevronDown
							size={18}
							color={colors.textMuted}
							style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}
						/>
						<Text variant="small" weight="semibold" tone="muted">
							{t.t("form.templatesMore")}
						</Text>
						<Text variant="small" tone="subtle" tabular>
							{t.number(rest.length)}
						</Text>
					</Pressable>
					{open ? (
						<TemplatePicker templates={rest} onPick={onPick} selectedKey={selectedKey} />
					) : null}
				</>
			) : null}
		</View>
	);
}

/** New identities get this icon when nothing else gives one (the store's default too). */
export const NEW_IDENTITY_EMOJI = "🌱";

let templateIdentities: IdentityTemplate[] | null = null;

/** The identity template a statement (or emoji) matches, in en or pt, ignoring case and accents. */
export function identityTemplateFor(identity: {
	statement: string;
	emoji?: string | null;
}): IdentityTemplate | null {
	const key = matchIdentityTemplate(identity);
	if (!key) return null;
	// Emoji and colors don't depend on the language.
	templateIdentities ??= identityTemplates("en");
	return templateIdentities.find((tpl) => tpl.key === key) ?? null;
}

export type IdentityChoice =
	| { mode: "none" }
	| { mode: "existing"; id: string }
	/** Created on save. `emoji`/`color` come from a suggestion chip or the icon sheet. */
	| { mode: "new"; statement: string; emoji?: string; color?: HabitColor };

/**
 * The look of an identity the editor will create: the chosen icon and color,
 * else those of the template identity its statement matches, else 🌱 and no
 * color. Null while the statement is empty.
 */
export function newIdentityLook(choice: {
	statement: string;
	emoji?: string;
	color?: HabitColor;
}): { statement: string; emoji: string; color: HabitColor | null } | null {
	const statement = choice.statement.trim();
	if (!statement) return null;
	const matched = identityTemplateFor({ statement });
	return {
		statement,
		emoji: choice.emoji ?? matched?.emoji ?? NEW_IDENTITY_EMOJI,
		color: choice.color ?? matched?.color ?? null,
	};
}

/**
 * Step 1 of the editor (Annex H §1.2): an existing identity, "No identity"
 * (with its hint), or a new one written inline. A suggestion chip sets the
 * new identity's statement, icon and color; the habit's auto icon and color
 * follow whatever is chosen here.
 */
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
	const text = useText();
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const [iconSheet, setIconSheet] = useState(false);
	const suggestions = useMemo(() => {
		const taken = new Set(identities.map((identity) => identityTemplateFor(identity)?.key));
		return identityTemplates(t.locale).filter((tpl) => !taken.has(tpl.key));
	}, [identities, t.locale]);
	const creating = value.mode === "new";
	const statement = value.mode === "new" ? value.statement : "";
	const look = value.mode === "new" ? newIdentityLook(value) : null;
	const newEmoji = value.mode === "new" ? (look?.emoji ?? value.emoji ?? NEW_IDENTITY_EMOJI) : "";
	const newColor = look?.color ?? (value.mode === "new" ? value.color : undefined);
	const setNew = (patch: Partial<Extract<IdentityChoice, { mode: "new" }>>) => {
		const current = value.mode === "new" ? value : { mode: "new" as const, statement: "" };
		onChange({ ...current, ...patch });
	};

	const row = ({
		key,
		selected,
		onPress,
		leading,
		label,
		hint,
		dashed,
	}: {
		key: string;
		selected: boolean;
		onPress: () => void;
		leading: ReactNode;
		label: string;
		hint?: string;
		dashed?: boolean;
	}) => (
		<PressableScale
			key={key}
			testID={`identity-option-${key}`}
			scaleTo={0.98}
			onPress={() => {
				haptics.selection();
				onPress();
			}}
			accessibilityRole="radio"
			accessibilityState={{ selected }}
			accessibilityLabel={label}
			accessibilityHint={hint}
			style={[
				styles.identity,
				dashed && !selected && styles.identityDashed,
				selected && { borderColor: colors.text },
			]}
		>
			{leading}
			<View style={{ flex: 1, gap: 2 }}>
				<Text weight="medium">{label}</Text>
				{hint ? (
					<Text variant="small" tone="muted">
						{hint}
					</Text>
				) : null}
			</View>
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
		<View
			style={{ gap: 8 }}
			accessibilityRole="radiogroup"
			accessibilityLabel={t.t("form.identity")}
		>
			{identities.map((identity) =>
				row({
					key: identity.id,
					selected: value.mode === "existing" && value.id === identity.id,
					onPress: () => onChange({ mode: "existing", id: identity.id }),
					leading: (
						<View style={[styles.identityEmoji, { backgroundColor: toneOf(identity.color).soft }]}>
							<Text style={{ fontSize: 18, lineHeight: 24 }} allowFontScaling={false}>
								{identity.emoji}
							</Text>
						</View>
					),
					label: text.identity(identity, "statement"),
				}),
			)}
			{row({
				key: "none",
				selected: value.mode === "none",
				onPress: () => onChange({ mode: "none" }),
				leading: (
					<View style={[styles.identityEmoji, { backgroundColor: colors.sunken }]}>
						<View style={[styles.noneDot, { backgroundColor: colors.borderStrong }]} />
					</View>
				),
				label: t.t("form.identityNone"),
				hint: t.t("form.identityNoneHint"),
			})}
			{row({
				key: "new",
				selected: creating,
				// A new identity replaces whatever was linked before.
				onPress: () => {
					if (!creating) onChange({ mode: "new", statement: "" });
				},
				leading: (
					<View style={[styles.identityEmoji, { backgroundColor: colors.sunken }]}>
						<Plus size={18} color={colors.text} />
					</View>
				),
				label: t.t("form.identityNew"),
				dashed: true,
			})}
			{value.mode === "new" ? (
				<View style={styles.newIdentity} testID="identity-new">
					<View style={styles.newIdentityRow}>
						<Pressable
							onPress={() => setIconSheet(true)}
							accessibilityRole="button"
							accessibilityLabel={`${t.t("form.emoji")} · ${t.t("form.identityNew")}: ${newEmoji}`}
							style={({ pressed }) => [
								styles.newIdentityEmoji,
								{ backgroundColor: newColor ? toneOf(newColor).soft : colors.sunken },
								pressed && { opacity: 0.7 },
							]}
							testID="identity-new-emoji"
						>
							<Text style={{ fontSize: 24, lineHeight: 30 }} allowFontScaling={false}>
								{newEmoji}
							</Text>
						</Pressable>
						<SmartTextField
							field="identity.statement"
							value={statement}
							onChangeText={(next) =>
								// An emptied field forgets the chip's icon and color.
								onChange(
									next.trim() ? { ...value, statement: next } : { mode: "new", statement: next },
								)
							}
							placeholder={t.t("form.identityPlaceholder")}
							accessibilityLabel={t.t("form.identityNew")}
							right={
								<AiSuggestButton
									kind="identity.statement"
									label={t.t("form.identity")}
									disabled={statement.trim().length < 2}
									input={() => ({ goal: statement.trim().slice(0, 160) })}
									onPick={(pick) => setNew({ statement: pick })}
								/>
							}
							autoFocus={!statement}
							maxLength={120}
							containerStyle={{ flex: 1 }}
							testID="identity-new-statement"
						/>
					</View>
					<Text variant="small" tone="muted">
						{t.x("editor.identityNewHint")}
					</Text>
					{suggestions.length ? (
						<View style={{ gap: 8, marginTop: 4 }}>
							<Text variant="label">{t.t("identity.suggestions")}</Text>
							<View style={styles.suggestions}>
								{suggestions.map((tpl) => {
									const selected = statement.trim() === tpl.statement;
									return (
										<PressableScale
											key={tpl.key}
											scaleTo={0.96}
											hitSlop={4}
											onPress={() => {
												haptics.selection();
												onChange({
													mode: "new",
													statement: tpl.statement,
													emoji: tpl.emoji,
													color: tpl.color,
												});
											}}
											accessibilityRole="button"
											accessibilityState={{ selected }}
											accessibilityLabel={tpl.statement}
											style={[
												styles.suggestion,
												selected && { backgroundColor: colors.text, borderColor: colors.text },
											]}
											testID={`identity-suggestion-${tpl.key}`}
										>
											<View
												style={[
													styles.suggestionEmoji,
													{ backgroundColor: toneOf(tpl.color).soft },
												]}
											>
												<Text style={{ fontSize: 14, lineHeight: 18 }} allowFontScaling={false}>
													{tpl.emoji}
												</Text>
											</View>
											<Text
												variant="small"
												weight="medium"
												color={selected ? colors.bg : colors.text}
												style={{ flexShrink: 1 }}
											>
												{tpl.statement}
											</Text>
										</PressableScale>
									);
								})}
							</View>
						</View>
					) : null}
					<Sheet
						open={iconSheet}
						onClose={() => setIconSheet(false)}
						title={t.t("form.emoji")}
						subtitle={statement.trim() || t.t("form.identityNew")}
						closeButton
						scroll
					>
						<EmojiPicker
							value={newEmoji}
							initiallyExpanded
							label={`${t.t("form.emoji")} · ${t.t("form.identityNew")}`}
							onChange={(emoji) => {
								setNew({ emoji });
								setIconSheet(false);
							}}
						/>
					</Sheet>
				</View>
			) : null}
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
	emojiSource: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
	emojiCaption: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		minHeight: 36,
		flexShrink: 1,
	},
	emojiReset: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		minHeight: 36,
		paddingHorizontal: 12,
		borderRadius: 999,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
		flexShrink: 1,
	},
	emojiInline: { fontSize: 16, lineHeight: 20 },
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
		borderWidth: 1.5,
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
	identityDashed: { borderStyle: "dashed", backgroundColor: t.colors.bg },
	noneDot: { width: 8, height: 8, borderRadius: 4 },
	newIdentity: {
		gap: 8,
		padding: 12,
		marginTop: -2,
		borderRadius: t.radii.lg,
		backgroundColor: t.colors.surface,
		borderWidth: 1,
		borderColor: t.colors.border,
	},
	newIdentityRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
	newIdentityEmoji: {
		width: 48,
		height: 48,
		borderRadius: t.radii.md,
		alignItems: "center",
		justifyContent: "center",
	},
	suggestions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
	suggestion: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		minHeight: 40,
		maxWidth: "100%",
		paddingLeft: 5,
		paddingRight: 12,
		paddingVertical: 5,
		borderRadius: 999,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
	suggestionEmoji: {
		width: 28,
		height: 28,
		borderRadius: 14,
		alignItems: "center",
		justifyContent: "center",
	},
	moreIdeas: {
		flexDirection: "row",
		alignItems: "center",
		alignSelf: "flex-start",
		gap: 6,
		minHeight: 44,
		paddingRight: 8,
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
