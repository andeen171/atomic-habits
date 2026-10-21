import { Check, PenLine, Pencil, Plus } from "@/components/icons";
import { PrincipleQuote } from "@/components/principles/principle-quote";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	type BlueprintField,
	type BlueprintLaw,
	type BlueprintSlot,
	type Habit,
	SETUP_FIELDS,
	type SetupField,
	blueprintSlots,
	lawHeading,
	lawPrinciple,
	setupFieldsFor,
	slotTitle,
	weakestLaw,
} from "@atomic/core";
import { type TextApi, useIdentity, useText } from "@atomic/core/react";
import { motion } from "@atomic/core/theme";
import { router } from "expo-router";
import { type ReactNode, useRef, useState } from "react";
import {
	AccessibilityInfo,
	type LayoutChangeEvent,
	Platform,
	Pressable,
	View,
	findNodeHandle,
} from "react-native";
import Animated, {
	type SharedValue,
	useAnimatedStyle,
	useSharedValue,
	withSpring,
	withTiming,
} from "react-native-reanimated";
import { BlueprintSlotSheet } from "./blueprint-slot-sheet";
import { SetupTaskAction } from "./setup-task-action";

export interface BlueprintBoardProps {
	habit: Habit;
	/**
	 * The host screen's scroll offset (`useScrollOffset`), for the sticky law
	 * headers. The board must then be a direct child of the scroll content.
	 */
	scrollY?: SharedValue<number>;
}

const LAWS: readonly BlueprintLaw[] = [1, 2, 3, 4];

/** Moves screen-reader (native) or keyboard (web) focus to a slot after its sheet closes. */
function focusNode(node: View | null | undefined) {
	if (!node) return;
	if (Platform.OS === "web") {
		(node as unknown as { focus?: () => void }).focus?.();
		return;
	}
	const handle = findNodeHandle(node);
	if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
}

/**
 * The habit's blueprint as a board (item 5; spec §6, D14, Annex H §1.3/§5):
 * the four laws stacked, each headed "law · stage" (the inverse laws for
 * break habits) with a header that sticks to the top while its slots
 * scroll by. A filled slot shows the user's words with the book's concept
 * under them; an empty slot shows the concept itself and its hint. Slots
 * open in a sheet. The header counts the slots in place, offers "Fill next"
 * and quotes the principle of the weakest law (D60); "Edit all" opens the
 * editor, and the footer is the identity vote.
 */
export function BlueprintBoard({ habit, scrollY }: BlueprintBoardProps) {
	const t = useT();
	const text = useText();
	const { colors } = useTheme();
	const styles = useStyles();
	const identity = useIdentity(habit.identityId);
	const [editing, setEditing] = useState(false);
	/** The sheet keeps its last slot while it animates out. */
	const [sheetField, setSheetField] = useState<BlueprintField | null>(null);
	const tiles = useRef(new Map<BlueprintField, View>());
	// Where the law sections sit in the scroll content (sticky headers).
	const rootY = useSharedValue(0);
	const cardY = useSharedValue(0);
	const listY = useSharedValue(0);

	const slots = blueprintSlots(habit);
	const filled = slots.filter((slot) => slot.value !== null).length;
	const total = slots.length;
	const next = slots.find((slot) => slot.value === null);
	const complete = filled === total;
	const convertible = new Set<SetupField>(setupFieldsFor(habit.kind).map((spec) => spec.field));
	const sheetSlot = slots.find((slot) => slot.field === sheetField);

	const open = (field: BlueprintField) => {
		haptics.selection();
		setSheetField(field);
		setEditing(true);
	};

	const y = (value: SharedValue<number>) => (event: LayoutChangeEvent) => {
		value.value = event.nativeEvent.layout.y;
	};

	return (
		<View onLayout={y(rootY)} style={styles.root} testID="blueprint-board">
			<SectionLabel
				right={
					<Button
						label={t.t("blueprint.board.editAll")}
						icon={Pencil}
						variant="ghost"
						size="sm"
						onPress={() => router.push({ pathname: "/habit/editor", params: { id: habit.id } })}
						testID="blueprint-edit-all"
					/>
				}
			>
				{t.t("detail.blueprint")}
			</SectionLabel>

			<View onLayout={y(cardY)} style={styles.card}>
				<View style={styles.summary}>
					<Text variant="small" tone="muted" tabular style={styles.count}>
						{t.t("blueprint.board.filled", { count: filled, total })}
					</Text>
					{next ? (
						<Button
							label={t.t("blueprint.board.fillNext")}
							icon={PenLine}
							variant="soft"
							size="sm"
							onPress={() => open(next.field)}
							testID="blueprint-fill-next"
						/>
					) : null}
				</View>
				<Meter habit={habit} filled={filled} total={total} />
				{complete ? (
					<View style={styles.complete}>
						<Check size={16} color={colors.success} strokeWidth={2.4} style={styles.completeIcon} />
						<Text variant="small" style={styles.completeText}>
							{t.t("blueprint.board.complete")}
						</Text>
					</View>
				) : null}
				<PrincipleQuote
					id={lawPrinciple(weakestLaw(habit), habit.kind)}
					variant="inline"
					style={styles.quote}
				/>

				<View onLayout={y(listY)}>
					{LAWS.map((law) => {
						const lawSlots = slots.filter((slot) => slot.law === law);
						if (!lawSlots.length) return null;
						return (
							<LawSection
								key={law}
								habit={habit}
								law={law}
								slots={lawSlots}
								scrollY={scrollY}
								base={[rootY, cardY, listY]}
							>
								{lawSlots.map((slot) => (
									<SlotRow
										key={slot.field}
										habit={habit}
										slot={slot}
										text={text}
										setup={
											slot.value !== null &&
											(SETUP_FIELDS as readonly string[]).includes(slot.field) &&
											convertible.has(slot.field as SetupField)
										}
										onPress={() => open(slot.field)}
										tileRef={(node) => {
											if (node) tiles.current.set(slot.field, node);
											else tiles.current.delete(slot.field);
										}}
									/>
								))}
							</LawSection>
						);
					})}
				</View>

				{identity && !identity.deletedAt ? (
					<Pressable
						onPress={() => router.push("/identity")}
						accessibilityRole="link"
						style={({ pressed }) => [styles.identity, pressed && styles.identityPressed]}
						testID="blueprint-identity"
					>
						<Text style={styles.identityEmoji} allowFontScaling={false}>
							{identity.emoji}
						</Text>
						<Text variant="display" italic tone="muted" style={styles.identityText}>
							{t.t("blueprint.identity", { identity: text.identity(identity, "statement") })}
						</Text>
					</Pressable>
				) : null}
			</View>

			<BlueprintSlotSheet
				habit={habit}
				slot={sheetSlot}
				open={editing && Boolean(sheetSlot)}
				onClose={() => setEditing(false)}
				onClosed={() => {
					if (sheetField) focusNode(tiles.current.get(sheetField));
				}}
			/>
		</View>
	);
}

/**
 * One law: a header ("1 Make it obvious · Cue") that sticks to the top of
 * the screen while the law's slots scroll under it, then the slots.
 */
function LawSection({
	habit,
	law,
	slots,
	scrollY,
	base,
	children,
}: {
	habit: Habit;
	law: BlueprintLaw;
	slots: BlueprintSlot[];
	scrollY?: SharedValue<number>;
	base: [SharedValue<number>, SharedValue<number>, SharedValue<number>];
	children: ReactNode;
}) {
	const t = useT();
	const styles = useStyles();
	const heading = lawHeading(law, habit.kind, t);
	const lawFilled = slots.filter((slot) => slot.value !== null).length;
	const top = useSharedValue(0);
	const height = useSharedValue(0);
	const headHeight = useSharedValue(0);
	const [rootY, cardY, listY] = base;

	// Each style reads the shared values itself: a mapper only re-runs for the
	// shared values in its own closure, not those of a worklet it calls.
	const stickStyle = useAnimatedStyle(() => {
		const start = rootY.value + cardY.value + listY.value + top.value;
		const room = Math.max(0, height.value - headHeight.value - 8);
		const y = scrollY ? Math.min(room, Math.max(0, scrollY.value - start)) : 0;
		return { transform: [{ translateY: y }] };
	});
	// A hairline under the header once it is stuck, so slots slide under an edge.
	const edgeStyle = useAnimatedStyle(() => {
		const start = rootY.value + cardY.value + listY.value + top.value;
		return { opacity: scrollY && scrollY.value > start ? 1 : 0 };
	});

	return (
		<View
			style={styles.section}
			onLayout={(event) => {
				top.value = event.nativeEvent.layout.y;
				height.value = event.nativeEvent.layout.height;
			}}
		>
			<Animated.View
				style={[styles.lawHead, stickStyle]}
				onLayout={(event) => {
					headHeight.value = event.nativeEvent.layout.height;
				}}
				accessibilityRole="header"
				accessible
				accessibilityLabel={`${law}. ${heading.name} · ${heading.stage}`}
				testID={`blueprint-law-${law}`}
			>
				<LawBadge habit={habit} law={law} filled={lawFilled} total={slots.length} />
				<Text variant="small" style={styles.lawText}>
					<Text variant="small" weight="semibold">
						{heading.name}
					</Text>
					<Text variant="small" tone="muted">{` · ${heading.stage}`}</Text>
				</Text>
				<Animated.View style={[styles.lawEdge, edgeStyle]} pointerEvents="none" />
			</Animated.View>
			<View style={styles.slots}>{children}</View>
		</View>
	);
}

/** The slot's words in the content language (D32); edits always change the original. */
function displayValue(habit: Habit, slot: BlueprintSlot, text: TextApi): string | null {
	if (slot.field === "cueTime") return slot.value;
	if (habit.kind === "break" && slot.field === "cueLocation") {
		return habit.cueLocation?.trim()
			? text.habit(habit, "cueLocation")
			: text.habit(habit, "stackAfter");
	}
	return text.habit(habit, slot.field);
}

/**
 * A slot as a ≥ 56pt row with press feedback: filled, the user's words over
 * the concept; empty, the concept over its hint, with a dashed edge and "+".
 * T2's "Make it a task" chip sits beside a filled convertible slot.
 */
function SlotRow({
	habit,
	slot,
	text,
	setup,
	onPress,
	tileRef,
}: {
	habit: Habit;
	slot: BlueprintSlot;
	text: TextApi;
	setup: boolean;
	onPress: () => void;
	tileRef: (node: View | null) => void;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const reduceMotion = useReduceMotion();
	const scale = useSharedValue(1);
	const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
	const value = slot.value ? displayValue(habit, slot, text) : null;
	const title = slotTitle({ ...slot, value }, t);
	const concept = t.t(slot.concept);
	const heading = lawHeading(slot.law, habit.kind, t);
	const isFilled = value !== null;

	return (
		<View style={styles.slotLine}>
			<Pressable
				ref={tileRef}
				onPress={onPress}
				onPressIn={() => {
					if (!reduceMotion) scale.value = withTiming(0.98, { duration: 90 });
				}}
				onPressOut={() => {
					scale.value = withSpring(1, motion.spring);
				}}
				accessibilityRole="button"
				accessibilityLabel={
					isFilled
						? `${t.t("blueprint.board.editField", { concept })}: ${title}`
						: t.t("blueprint.board.add", { concept })
				}
				accessibilityHint={
					isFilled
						? `${heading.name} · ${heading.stage}`
						: `${heading.name} · ${heading.stage}. ${t.t(slot.hint)}`
				}
				style={styles.slotPress}
				testID={`blueprint-slot-${slot.field}`}
			>
				{({ pressed }) => (
					<Animated.View
						style={[
							styles.tile,
							isFilled ? styles.tileFilled : styles.tileEmpty,
							pressed && (isFilled ? styles.tileFilledPressed : styles.tileEmptyPressed),
							pressStyle,
						]}
					>
						{isFilled ? null : (
							<View style={styles.plus}>
								<Plus size={14} color={colors.textMuted} strokeWidth={2.4} />
							</View>
						)}
						<View style={styles.tileText}>
							<Text weight="medium" tone={isFilled ? "default" : "muted"} style={styles.tileTitle}>
								{title}
							</Text>
							<Text variant="small" tone="muted" style={styles.tileSub}>
								{isFilled ? concept : t.t(slot.hint)}
							</Text>
						</View>
						{isFilled ? <Pencil size={15} color={colors.textSubtle} style={styles.pencil} /> : null}
					</Animated.View>
				)}
			</Pressable>
			{setup ? <SetupTaskAction habit={habit} field={slot.field as SetupField} compact /> : null}
		</View>
	);
}

/** The law's number, filled in the habit's colour once every slot of the law is in place. */
function LawBadge({
	habit,
	law,
	filled,
	total,
}: { habit: Habit; law: BlueprintLaw; filled: number; total: number }) {
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const tone = toneOf(habit.color);
	const full = filled === total;
	return (
		<View
			style={[
				styles.badge,
				full
					? { backgroundColor: tone.fill }
					: filled > 0
						? { backgroundColor: tone.soft }
						: { backgroundColor: colors.sunken, borderWidth: 1, borderColor: colors.border },
			]}
		>
			<Text
				variant="tiny"
				weight="semibold"
				tabular
				color={full ? tone.onText : filled > 0 ? colors.text : colors.textMuted}
			>
				{law}
			</Text>
		</View>
	);
}

/** One segment per slot, in the habit's colour as slots fill (the count is the text above it). */
function Meter({ habit, filled, total }: { habit: Habit; filled: number; total: number }) {
	const { colors, habit: toneOf } = useTheme();
	const styles = useStyles();
	const tone = toneOf(habit.color);
	return (
		<View
			style={styles.meter}
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
		>
			{Array.from({ length: total }, (_, i) => (
				<View
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative segments.
					key={i}
					style={[styles.segment, { backgroundColor: i < filled ? tone.fill : colors.heat0 }]}
				/>
			))}
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	root: { marginBottom: 22 },
	card: {
		backgroundColor: t.colors.surface,
		borderRadius: t.radii.xl - 2,
		borderWidth: 1,
		borderColor: t.colors.border,
		paddingHorizontal: 16,
		paddingTop: 14,
		paddingBottom: 16,
		...t.cardShadow,
	},
	summary: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		flexWrap: "wrap",
		gap: 8,
		minHeight: 36,
	},
	count: { flexShrink: 1 },
	meter: { flexDirection: "row", gap: 3, marginTop: 8 },
	segment: { flex: 1, height: 6, borderRadius: 3 },
	complete: { flexDirection: "row", gap: 8, marginTop: 12 },
	completeIcon: { marginTop: 1 },
	completeText: { flex: 1 },
	quote: { marginTop: 14 },
	section: { marginTop: 14 },
	lawHead: {
		zIndex: 2,
		flexDirection: "row",
		alignItems: "center",
		gap: 10,
		minHeight: 44,
		marginHorizontal: -16,
		paddingHorizontal: 16,
		paddingVertical: 8,
		backgroundColor: t.colors.surface,
	},
	lawEdge: {
		position: "absolute",
		left: 0,
		right: 0,
		bottom: 0,
		height: 1,
		backgroundColor: t.colors.border,
	},
	lawText: { flex: 1 },
	badge: {
		width: 26,
		height: 26,
		borderRadius: 13,
		alignItems: "center",
		justifyContent: "center",
	},
	slots: { gap: 8, marginTop: 2 },
	slotLine: { flexDirection: "row", alignItems: "center", gap: 6 },
	slotPress: { flex: 1, minWidth: 0 },
	tile: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 12,
		minHeight: 56,
		paddingHorizontal: 14,
		paddingVertical: 11,
		borderRadius: t.radii.md,
		borderWidth: 1,
	},
	tileFilled: { backgroundColor: t.colors.surface, borderColor: t.colors.border },
	tileFilledPressed: { backgroundColor: t.colors.hover, borderColor: t.colors.borderStrong },
	tileEmpty: {
		backgroundColor: t.colors.sunken,
		borderColor: t.colors.borderStrong,
		borderStyle: "dashed",
	},
	tileEmptyPressed: { backgroundColor: t.colors.hover },
	plus: {
		width: 22,
		height: 22,
		borderRadius: 11,
		marginTop: 1,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: t.colors.surface,
		borderWidth: 1,
		borderColor: t.colors.borderStrong,
	},
	tileText: { flex: 1, minWidth: 0 },
	tileTitle: { lineHeight: 20 },
	tileSub: { marginTop: 2 },
	pencil: { marginTop: 3 },
	identity: {
		flexDirection: "row",
		gap: 10,
		marginTop: 18,
		marginBottom: -16,
		marginHorizontal: -16,
		borderBottomLeftRadius: t.radii.xl - 3,
		borderBottomRightRadius: t.radii.xl - 3,
		paddingHorizontal: 16,
		paddingTop: 14,
		paddingBottom: 16,
		borderTopWidth: 1,
		borderTopColor: t.colors.border,
	},
	identityPressed: { backgroundColor: t.colors.hover },
	identityEmoji: { fontSize: 20, lineHeight: 28 },
	identityText: { flex: 1, fontSize: 21, lineHeight: 27 },
}));
