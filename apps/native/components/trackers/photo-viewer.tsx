import { ChevronLeft, ChevronRight, Columns2, Pencil, X } from "@/components/icons";
import { Portal } from "@/components/sheet/portal";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { blobStore } from "@/lib/blob-store";
import { haptics } from "@/lib/haptics";
import { type AppTranslator, useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { ui } from "@/lib/ui-store";
import { afterSheet } from "@/lib/use-tracker-actions";
import { type DayKey, diffDays, photoAlt } from "@atomic/core";
import { useHabit, useToday, useTracker } from "@atomic/core/react";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	ActivityIndicator,
	BackHandler,
	FlatList,
	type GestureResponderEvent,
	Image,
	type LayoutChangeEvent,
	PanResponder,
	Platform,
	ScrollView,
	StyleSheet,
	View,
	useWindowDimensions,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { MissingPhotoIcon, PhotoThumb, missingPhotoText, usePhotoSource } from "./photo-thumb";
import { type PhotoViewerState, type ViewerPhoto, trackerUI, useTrackerUI } from "./tracker-ui";

/**
 * The photo viewer (Annex K §1.8.11, §5.1; spec §6): full screen over black,
 * mounted once next to the entry composer and opened with
 * `trackerUI.openViewer`. Two modes:
 * - a timeline of photos (a period's gallery, an entry's photos): swipe
 *   between them, or tap the filmstrip; screen readers adjust it like a
 *   slider; "Edit entry" opens the photo's entry;
 * - then and now (progress photo): side by side, or one over the other with
 *   a slider (drag anywhere on the photo).
 * The original shows when it's on this device; meanwhile the thumbnail
 * stands in, blurred, with the same placeholders as the thumbnails. Android
 * back and Escape close it. The native twin of web `photo-viewer.tsx`.
 * Owner: T4.
 */
export function PhotoViewer() {
	const state = useTrackerUI((s) => s.viewer);
	// Keep the last state while the viewer fades out.
	const [shown, setShown] = useState<PhotoViewerState | null>(state);
	if (state && state !== shown) setShown(state);
	if (!shown) return null;
	return (
		<Portal>
			<ViewerFrame state={shown} open={state !== null} onExited={() => setShown(null)} />
		</Portal>
	);
}

const WHITE = "#FFFFFF";
const WHITE_MUTED = "rgba(255,255,255,0.72)";

function ViewerFrame({
	state,
	open,
	onExited,
}: {
	state: PhotoViewerState;
	open: boolean;
	onExited(): void;
}) {
	const reduceMotion = useReduceMotion();
	const opacity = useSharedValue(0);
	const close = trackerUI.closeViewer;

	// biome-ignore lint/correctness/useExhaustiveDependencies: animate on open changes only.
	useEffect(() => {
		if (open) {
			opacity.value = withTiming(1, { duration: reduceMotion ? 1 : 180 });
			return;
		}
		opacity.value = withTiming(0, { duration: reduceMotion ? 1 : 160 }, (finished) => {
			if (finished) scheduleOnRN(onExited);
		});
	}, [open]);

	// A modal surface: the app behind it is hidden from screen readers and toasts move up.
	useEffect(() => {
		if (!open) return;
		return ui.trackSheet(false);
	}, [open]);

	// Android back closes it (before any sheet underneath).
	useEffect(() => {
		if (!open || Platform.OS === "web") return;
		const sub = BackHandler.addEventListener("hardwareBackPress", () => {
			close();
			return true;
		});
		return () => sub.remove();
	}, [open, close]);

	const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
	return (
		<Animated.View
			style={[StyleSheet.absoluteFill, styles.frame, style]}
			pointerEvents={open ? "auto" : "none"}
			accessibilityViewIsModal
			importantForAccessibility="yes"
			testID="photo-viewer"
		>
			{open ? <StatusBar style="light" /> : null}
			{state.mode === "photos" ? (
				<TimelineView
					key={`${state.index}:${state.photos.map((p) => p.ref.hash).join()}`}
					state={state}
					open={open}
				/>
			) : (
				<CompareView state={state} open={open} />
			)}
		</Animated.View>
	);
}

/**
 * Escape (web) closes the viewer, and the arrow keys reach `onKey`. Captured
 * before the sheets' own Escape, so a viewer opened from the composer closes
 * alone.
 */
function useViewerKeys(open: boolean, onKey: (key: string) => boolean) {
	const handler = useRef(onKey);
	handler.current = onKey;
	useEffect(() => {
		if (!open || Platform.OS !== "web") return;
		const listener = (event: KeyboardEvent) => {
			const handled = event.key === "Escape" ? true : handler.current(event.key);
			if (!handled) return;
			event.preventDefault();
			event.stopPropagation();
			if (event.key === "Escape") trackerUI.closeViewer();
		};
		globalThis.addEventListener?.("keydown", listener, true);
		return () => globalThis.removeEventListener?.("keydown", listener, true);
	}, [open]);
}

/**
 * "Today", "Tuesday, March 3" (or "Mar 3" when `short`), with the year when
 * it isn't this one.
 */
function usePhotoDay(short = false) {
	const t = useT();
	const today = useToday();
	return (day: DayKey | "") => {
		if (!day) return "";
		const near = Math.abs(diffDays(day, today)) <= 1;
		const label = short && !near ? t.formatDayShort(day) : t.formatRelativeDay(day, today);
		return day.slice(0, 4) === today.slice(0, 4) ? label : `${label}, ${day.slice(0, 4)}`;
	};
}

const altOf = (photo: ViewerPhoto, t: AppTranslator) =>
	photo.day ? photoAlt(photo.ref, { date: photo.day, data: { caption: photo.caption } }, t) : "";

function TopBar({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
	const t = useT();
	const insets = useSafeAreaInsets();
	return (
		<View style={[styles.topBar, { paddingTop: Math.max(12, insets.top + 6) }]}>
			<View style={styles.topText}>{children}</View>
			<View style={styles.topActions}>
				{actions}
				<PressableScale
					onPress={trackerUI.closeViewer}
					scaleTo={0.92}
					accessibilityRole="button"
					accessibilityLabel={t.t("common.close")}
					style={styles.roundButton}
					testID="photo-viewer-close"
				>
					<X size={24} color={WHITE} />
				</PressableScale>
			</View>
		</View>
	);
}

/** "Edit entry" for a saved photo whose tracker can still be edited. */
function EditEntryButton({ habitId, photo }: { habitId: string | null; photo: ViewerPhoto }) {
	const t = useT();
	const { width } = useWindowDimensions();
	const habit = useHabit(habitId ?? undefined);
	const tracker = useTracker(habit);
	if (!habit || !tracker?.active || habit.archivedAt || !photo.entryId || !photo.day) return null;
	const { entryId, day } = photo;
	const label = t.t("tracker.editEntry");
	const wide = width >= 440;
	return (
		<PressableScale
			onPress={() => {
				haptics.selection();
				trackerUI.closeViewer();
				afterSheet(() => ui.openEntryComposer({ habitId: habit.id, day, entryId }));
			}}
			scaleTo={0.95}
			accessibilityRole="button"
			accessibilityLabel={label}
			style={wide ? styles.pillButton : styles.roundButton}
			testID="photo-viewer-edit"
		>
			<Pencil size={18} color={WHITE} />
			{wide ? (
				<Text variant="small" weight="semibold" color={WHITE}>
					{label}
				</Text>
			) : null}
		</PressableScale>
	);
}

// ── Timeline ──────────────────────────────────────────────────────────────

function TimelineView({
	state,
	open,
}: {
	state: Extract<PhotoViewerState, { mode: "photos" }>;
	open: boolean;
}) {
	const t = useT();
	const dayLabel = usePhotoDay();
	const reduceMotion = useReduceMotion();
	const insets = useSafeAreaInsets();
	const { photos } = state;
	const count = photos.length;
	const [index, setIndex] = useState(() =>
		Math.min(Math.max(0, state.index), Math.max(0, count - 1)),
	);
	const [size, setSize] = useState<{ w: number; h: number } | null>(null);
	const listRef = useRef<FlatList<ViewerPhoto>>(null);
	const indexRef = useRef(index);
	indexRef.current = index;
	const photo = photos[index];

	// Warm the neighbours' originals, so a swipe shows them at once.
	useEffect(() => {
		for (const near of [photos[index - 1], photos[index + 1]]) {
			if (near) void blobStore.url(near.ref.hash);
		}
	}, [photos, index]);

	// A new size (rotation, split screen): stay on the same photo.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-align on width changes only.
	useEffect(() => {
		if (!size) return;
		listRef.current?.scrollToOffset({ offset: indexRef.current * size.w, animated: false });
	}, [size?.w]);

	const go = (next: number) => {
		const target = Math.min(count - 1, Math.max(0, next));
		if (target === indexRef.current) return;
		haptics.selection();
		setIndex(target);
		if (size) listRef.current?.scrollToOffset({ offset: target * size.w, animated: !reduceMotion });
	};

	useViewerKeys(open, (key) => {
		const keys: Record<string, number> = {
			ArrowLeft: indexRef.current - 1,
			ArrowRight: indexRef.current + 1,
			Home: 0,
			End: count - 1,
		};
		const target = keys[key];
		if (target === undefined || count < 2) return false;
		go(target);
		return true;
	});

	if (!photo) return null;
	const alt =
		altOf(photo, t) ||
		t.t("tracker.photo.open", { index: t.number(index + 1), total: t.number(count) });
	const position =
		count > 1
			? t.t("tracker.photo.position", { index: t.number(index + 1), total: t.number(count) })
			: null;

	const onLayout = (event: LayoutChangeEvent) => {
		const { width, height } = event.nativeEvent.layout;
		if (width > 0 && height > 0) setSize({ w: Math.round(width), h: Math.round(height) });
	};

	return (
		<View style={styles.fill}>
			<TopBar actions={<EditEntryButton habitId={state.habitId} photo={photo} />}>
				{photo.day ? (
					<Text variant="h3" color={WHITE} numberOfLines={1}>
						{dayLabel(photo.day)}
					</Text>
				) : null}
				{position ? (
					<Text variant="small" color={WHITE_MUTED} tabular accessibilityLiveRegion="polite">
						{position}
					</Text>
				) : null}
			</TopBar>
			<View
				style={styles.fill}
				onLayout={onLayout}
				accessible
				accessibilityRole={count > 1 ? "adjustable" : "image"}
				accessibilityLabel={alt}
				accessibilityValue={position ? { text: position } : undefined}
				accessibilityActions={
					count > 1
						? [
								{ name: "increment", label: t.t("tracker.photo.next") },
								{ name: "decrement", label: t.t("tracker.photo.previous") },
							]
						: undefined
				}
				onAccessibilityAction={(event) => {
					if (event.nativeEvent.actionName === "increment") go(indexRef.current + 1);
					else if (event.nativeEvent.actionName === "decrement") go(indexRef.current - 1);
				}}
			>
				{size ? (
					<FlatList
						ref={listRef}
						data={photos}
						horizontal
						pagingEnabled
						showsHorizontalScrollIndicator={false}
						keyExtractor={(item, i) => `${item.ref.hash}:${i}`}
						initialScrollIndex={index}
						getItemLayout={(_, i) => ({ length: size.w, offset: size.w * i, index: i })}
						initialNumToRender={1}
						maxToRenderPerBatch={2}
						windowSize={3}
						scrollEventThrottle={32}
						onScroll={(event) => {
							const next = Math.round(event.nativeEvent.contentOffset.x / size.w);
							if (next !== indexRef.current && next >= 0 && next < count) setIndex(next);
						}}
						renderItem={({ item }) => (
							<View style={{ width: size.w, height: size.h }}>
								<FullPhoto photo={item} alt="" />
							</View>
						)}
						testID="photo-viewer-pager"
					/>
				) : null}
				{count > 1 && size && size.w >= 600 ? (
					<>
						<NavButton
							side="left"
							label={t.t("tracker.photo.previous")}
							hidden={index === 0}
							onPress={() => go(index - 1)}
						/>
						<NavButton
							side="right"
							label={t.t("tracker.photo.next")}
							hidden={index === count - 1}
							onPress={() => go(index + 1)}
						/>
					</>
				) : null}
			</View>
			<View style={[styles.bottom, { paddingBottom: Math.max(16, insets.bottom + 8) }]}>
				{photo.caption ? (
					<Text color={WHITE} align="center" numberOfLines={4} style={styles.caption}>
						{photo.caption}
					</Text>
				) : null}
				{count > 1 ? <Filmstrip photos={photos} index={index} onPick={go} /> : null}
			</View>
		</View>
	);
}

function NavButton({
	side,
	label,
	hidden,
	onPress,
}: {
	side: "left" | "right";
	label: string;
	hidden: boolean;
	onPress(): void;
}) {
	if (hidden) return null;
	const Icon = side === "left" ? ChevronLeft : ChevronRight;
	return (
		<PressableScale
			onPress={onPress}
			scaleTo={0.92}
			accessibilityRole="button"
			accessibilityLabel={label}
			style={[styles.navButton, side === "left" ? { left: 16 } : { right: 16 }]}
		>
			<Icon size={28} color={WHITE} />
		</PressableScale>
	);
}

const STRIP = 52;
const STRIP_GAP = 6;

/** The filmstrip: every photo of the set, in order, the current one framed. */
function Filmstrip({
	photos,
	index,
	onPick,
}: {
	photos: readonly ViewerPhoto[];
	index: number;
	onPick(index: number): void;
}) {
	const t = useT();
	const dayLabel = usePhotoDay();
	const reduceMotion = useReduceMotion();
	const scrollRef = useRef<ScrollView>(null);
	const [width, setWidth] = useState(0);
	// Keeps the current photo in the middle of the strip.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-centres when the photo changes.
	useEffect(() => {
		if (!width) return;
		const x = 4 + index * (STRIP + STRIP_GAP) + STRIP / 2 - width / 2;
		scrollRef.current?.scrollTo({ x: Math.max(0, x), animated: !reduceMotion });
	}, [index, width]);
	const content = photos.length * (STRIP + STRIP_GAP) - STRIP_GAP + 8;
	return (
		<View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
			<Text style={styles.hidden} accessibilityRole="header">
				{t.t("tracker.photo.timeline")}
			</Text>
			<ScrollView
				ref={scrollRef}
				horizontal
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={[
					styles.strip,
					width > content && { flexGrow: 1, justifyContent: "center" },
				]}
			>
				{photos.map((photo, i) => {
					const label = [
						t.t("tracker.photo.open", {
							index: t.number(i + 1),
							total: t.number(photos.length),
						}),
						photo.day ? dayLabel(photo.day) : null,
					]
						.filter(Boolean)
						.join(" · ");
					const current = i === index;
					return (
						<View
							key={`${photo.ref.hash}:${i}`}
							style={[styles.stripItem, current ? styles.stripCurrent : styles.stripOther]}
						>
							<PhotoThumb
								photo={photo.ref}
								alt={label}
								label={label}
								size={STRIP}
								radius={6}
								onDark
								onPress={() => onPick(i)}
							/>
						</View>
					);
				})}
			</ScrollView>
		</View>
	);
}

/**
 * The original, or the thumbnail (blurred, better than nothing) while it
 * downloads; the placeholder when it can't be had.
 */
function FullPhoto({
	photo,
	alt,
	fit = "contain",
}: {
	photo: ViewerPhoto;
	alt: string;
	fit?: "contain" | "cover";
}) {
	const t = useT();
	const source = usePhotoSource(photo.ref, "full");
	if (!source.src) {
		if (source.status === "loading") {
			return (
				<View style={styles.center} accessible accessibilityLabel={t.t("tracker.photo.loading")}>
					<ActivityIndicator size="large" color={WHITE_MUTED} />
				</View>
			);
		}
		const text = missingPhotoText(source.where, t, true);
		return (
			<View style={styles.center}>
				<View
					style={styles.missing}
					accessible
					accessibilityRole="image"
					accessibilityLabel={[alt, text].filter(Boolean).join(" · ")}
				>
					<MissingPhotoIcon where={source.where} size={30} color={WHITE_MUTED} />
					<Text color={WHITE} align="center">
						{text}
					</Text>
				</View>
			</View>
		);
	}
	return (
		<View style={StyleSheet.absoluteFill}>
			<Image
				source={{ uri: source.src }}
				style={StyleSheet.absoluteFill}
				resizeMode={fit}
				blurRadius={source.degraded ? 3 : 0}
				onError={source.onError}
				accessibilityIgnoresInvertColors
				accessible={!!alt}
				accessibilityLabel={alt || undefined}
			/>
			{source.degraded ? (
				<View style={styles.degraded} pointerEvents="none">
					<View style={styles.degradedPill}>
						{source.status === "loading" ? (
							<ActivityIndicator size="small" color={WHITE} />
						) : (
							<MissingPhotoIcon where={source.where} size={16} color={WHITE} />
						)}
						<Text variant="small" color={WHITE} style={styles.shrink}>
							{source.status === "loading"
								? t.t("tracker.photo.loading")
								: missingPhotoText(source.where, t, true)}
						</Text>
					</View>
				</View>
			) : null}
		</View>
	);
}

// ── Then and now ──────────────────────────────────────────────────────────

type CompareMode = "side" | "overlay";

function CompareView({
	state,
	open,
}: {
	state: Extract<PhotoViewerState, { mode: "compare" }>;
	open: boolean;
}) {
	const t = useT();
	const dayLabel = usePhotoDay(true);
	const [mode, setMode] = useState<CompareMode>("side");
	const [split, setSplit] = useState(50);
	const { before, after } = state;
	const days =
		before.day && after.day ? Math.max(0, diffDays(after.day as DayKey, before.day as DayKey)) : 0;
	const caption = (which: "then" | "now", photo: ViewerPhoto) =>
		`${t.t(which === "then" ? "tracker.photo.then" : "tracker.photo.now")} · ${dayLabel(photo.day)}`;

	useViewerKeys(open, (key) => {
		if (mode !== "overlay" || (key !== "ArrowLeft" && key !== "ArrowRight")) return false;
		setSplit((value) => Math.min(100, Math.max(0, value + (key === "ArrowLeft" ? -5 : 5))));
		return true;
	});

	return (
		<View style={styles.fill}>
			<TopBar>
				<Text variant="h3" color={WHITE} accessibilityRole="header">
					{t.t("tracker.photo.compare")}
				</Text>
				{days > 0 ? (
					<Text variant="small" color={WHITE_MUTED}>
						{t.tp("tracker.photo.progressDays", days)}
					</Text>
				) : null}
			</TopBar>
			<ModeSwitch mode={mode} onChange={setMode} />
			{mode === "side" ? (
				<SideBySide before={before} after={after} caption={caption} />
			) : (
				<Overlay
					before={before}
					after={after}
					split={split}
					onSplit={setSplit}
					label={(which) => caption(which, which === "then" ? before : after)}
				/>
			)}
		</View>
	);
}

function ModeSwitch({ mode, onChange }: { mode: CompareMode; onChange(mode: CompareMode): void }) {
	const t = useT();
	const options: { value: CompareMode; label: string }[] = [
		{ value: "side", label: t.t("tracker.photo.sideBySide") },
		{ value: "overlay", label: t.t("tracker.photo.overlay") },
	];
	return (
		<View style={styles.modeRow}>
			<View
				style={styles.modeGroup}
				accessibilityRole="radiogroup"
				accessibilityLabel={t.t("tracker.photo.compareMode")}
			>
				{options.map((option) => {
					const selected = mode === option.value;
					return (
						<PressableScale
							key={option.value}
							onPress={() => {
								if (selected) return;
								haptics.selection();
								onChange(option.value);
							}}
							scaleTo={0.96}
							accessibilityRole="radio"
							accessibilityState={{ checked: selected }}
							accessibilityLabel={option.label}
							style={[styles.modeOption, selected && styles.modeSelected]}
							testID={`compare-${option.value}`}
						>
							{option.value === "side" ? (
								<Columns2 size={16} color={selected ? "#000000" : WHITE_MUTED} />
							) : null}
							<Text variant="small" weight="semibold" color={selected ? "#000000" : WHITE_MUTED}>
								{option.label}
							</Text>
						</PressableScale>
					);
				})}
			</View>
		</View>
	);
}

/**
 * The room under the mode switch, measured: the photos are sized to fit it
 * and centred in it together with what belongs under them (captions, the
 * slider), so nothing is stranded at the bottom of a tall phone screen.
 */
function useStage() {
	const [stage, setStage] = useState<{ w: number; h: number } | null>(null);
	const onLayout = (event: LayoutChangeEvent) => {
		const { width, height } = event.nativeEvent.layout;
		if (width > 0 && height > 0) setStage({ w: Math.round(width), h: Math.round(height) });
	};
	return [stage, onLayout] as const;
}

const SIDE_GAP = 8;
/** Room kept under the photos for a caption of up to two lines. */
const CAPTION_ROOM = 54;

/** Height ÷ width of a photo (square when its size is unknown). */
const tallness = (photo: ViewerPhoto) =>
	photo.ref.w > 0 && photo.ref.h > 0 ? photo.ref.h / photo.ref.w : 1;

/**
 * Then beside now: both photos in cells of one size (the taller photo's
 * shape, as large as the screen allows), each caption right under its photo.
 * A longer caption never moves a photo.
 */
function SideBySide({
	before,
	after,
	caption,
}: {
	before: ViewerPhoto;
	after: ViewerPhoto;
	caption(which: "then" | "now", photo: ViewerPhoto): string;
}) {
	const t = useT();
	const dayLabel = usePhotoDay(true);
	const insets = useSafeAreaInsets();
	const [stage, onLayout] = useStage();
	const pairs = [
		["then", before],
		["now", after],
	] as const;
	const cellW = stage ? Math.floor((stage.w - SIDE_GAP) / 2) : 0;
	const cellH = stage
		? Math.round(
				Math.max(
					80,
					Math.min(stage.h - CAPTION_ROOM, cellW * Math.max(tallness(before), tallness(after))),
				),
			)
		: 0;
	return (
		<View
			style={[styles.fill, styles.stagePad, { paddingBottom: Math.max(16, insets.bottom + 8) }]}
		>
			<View style={[styles.fill, styles.stage]} onLayout={onLayout}>
				{stage ? (
					<>
						<View style={styles.sideRow}>
							{pairs.map(([which, photo]) => (
								<View key={which} style={{ width: cellW, height: cellH }}>
									<FullPhoto photo={photo} alt={`${caption(which, photo)} · ${altOf(photo, t)}`} />
								</View>
							))}
						</View>
						<View style={styles.sideRow}>
							{pairs.map(([which, photo]) => (
								<Text
									key={which}
									variant="small"
									color={WHITE_MUTED}
									align="center"
									numberOfLines={2}
									style={{ width: cellW }}
									importantForAccessibility="no-hide-descendants"
									accessibilityElementsHidden
								>
									<Text variant="small" weight="semibold" color={WHITE}>
										{t.t(which === "then" ? "tracker.photo.then" : "tracker.photo.now")}
									</Text>
									{` · ${dayLabel(photo.day)}`}
								</Text>
							))}
						</View>
					</>
				) : null}
			</View>
		</View>
	);
}

/** The slider under the overlay, and the gap above it. */
const SLIDER_ROOM = 44 + 16;

/** Then under now, with a draggable split; the frame takes the latest photo's shape. */
function Overlay({
	before,
	after,
	split,
	onSplit,
	label,
}: {
	before: ViewerPhoto;
	after: ViewerPhoto;
	split: number;
	onSplit(split: number): void;
	label(which: "then" | "now"): string;
}) {
	const t = useT();
	const insets = useSafeAreaInsets();
	const [stage, onLayout] = useStage();
	const ratio = 1 / tallness(after);
	const room = stage ? { w: stage.w, h: Math.max(80, stage.h - SLIDER_ROOM) } : null;
	const frame = room
		? room.w / room.h > ratio
			? { w: Math.round(room.h * ratio), h: room.h }
			: { w: room.w, h: Math.round(room.w / ratio) }
		: null;
	const frameW = useRef(0);
	frameW.current = frame?.w ?? 0;
	const onSplitRef = useRef(onSplit);
	onSplitRef.current = onSplit;
	// Drag anywhere on the photo, or along the slider under it: both are as wide as the photo,
	// so the thumb sits right under the split. Children don't take touches, so `locationX` is
	// measured from the photo's left edge.
	const [pan] = useState(() => splitResponder(() => frameW.current, onSplitRef));
	const value = `${t.t("tracker.photo.then")} ${t.percent(split / 100)} · ${t.t("tracker.photo.now")} ${t.percent(1 - split / 100)}`;
	const cut = frame ? (frame.w * split) / 100 : 0;
	return (
		<View
			style={[styles.fill, styles.stagePad, { paddingBottom: Math.max(16, insets.bottom + 8) }]}
		>
			<View style={[styles.fill, styles.stage, { gap: 16 }]} onLayout={onLayout}>
				{frame ? (
					<>
						<View
							style={[styles.overlayFrame, { width: frame.w, height: frame.h }]}
							pointerEvents="box-only"
							accessible
							accessibilityRole="image"
							accessibilityLabel={`${label("then")} · ${label("now")}`}
							{...pan.panHandlers}
						>
							<FullPhoto photo={before} alt="" fit="cover" />
							<View style={[styles.clip, { left: cut }]}>
								<View style={[styles.clipInner, { left: -cut, width: frame.w }]}>
									<FullPhoto photo={after} alt="" fit="cover" />
								</View>
							</View>
							<View style={[styles.divider, { left: cut - 1 }]} />
							<View style={[styles.knob, { left: cut - 16, top: frame.h / 2 - 16 }]}>
								<ChevronLeft size={14} color="#000000" strokeWidth={2.6} />
								<ChevronRight size={14} color="#000000" strokeWidth={2.6} />
							</View>
							<View style={[styles.tag, { left: 8 }]}>
								<Text variant="tiny" weight="semibold" color={WHITE}>
									{label("then")}
								</Text>
							</View>
							<View style={[styles.tag, { right: 8 }]}>
								<Text variant="tiny" weight="semibold" color={WHITE}>
									{label("now")}
								</Text>
							</View>
						</View>
						<View
							style={[styles.slider, { width: frame.w }]}
							pointerEvents="box-only"
							accessible
							accessibilityRole="adjustable"
							accessibilityLabel={t.t("tracker.photo.reveal")}
							accessibilityValue={{ min: 0, max: 100, now: split, text: value }}
							accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
							onAccessibilityAction={(event) => {
								const step = event.nativeEvent.actionName === "increment" ? 10 : -10;
								onSplit(Math.min(100, Math.max(0, split + step)));
							}}
							testID="compare-slider"
							{...pan.panHandlers}
						>
							<View style={styles.sliderTrack} />
							<View style={[styles.sliderFill, { width: cut }]} />
							<View style={[styles.sliderThumb, { left: cut - 12 }]} />
						</View>
					</>
				) : null}
			</View>
		</View>
	);
}

/** A responder that sets the split (0–100) from the touch's distance to the left edge. */
function splitResponder(width: () => number, onSplit: { current: (split: number) => void }) {
	const set = (event: GestureResponderEvent) => {
		const w = width();
		if (w > 0) {
			onSplit.current(
				Math.round(Math.min(100, Math.max(0, (event.nativeEvent.locationX / w) * 100))),
			);
		}
	};
	return PanResponder.create({
		onStartShouldSetPanResponder: () => true,
		onMoveShouldSetPanResponder: () => true,
		onPanResponderTerminationRequest: () => false,
		onPanResponderGrant: set,
		onPanResponderMove: set,
	});
}

const styles = StyleSheet.create({
	frame: { backgroundColor: "#000000" },
	fill: { flex: 1, minHeight: 0, minWidth: 0 },
	shrink: { flexShrink: 1 },
	hidden: { position: "absolute", width: 1, height: 1, opacity: 0 },
	topBar: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 12,
		paddingHorizontal: 12,
		paddingBottom: 8,
	},
	topText: { flex: 1, minWidth: 0, paddingTop: 8, paddingLeft: 6, gap: 1 },
	topActions: { flexDirection: "row", alignItems: "center", gap: 4 },
	roundButton: {
		width: 44,
		height: 44,
		borderRadius: 22,
		alignItems: "center",
		justifyContent: "center",
	},
	pillButton: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		height: 44,
		paddingHorizontal: 14,
		borderRadius: 22,
	},
	bottom: { gap: 12, paddingTop: 12, paddingHorizontal: 16 },
	caption: { maxWidth: 640, alignSelf: "center" },
	navButton: {
		position: "absolute",
		top: "50%",
		marginTop: -24,
		width: 48,
		height: 48,
		borderRadius: 24,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "rgba(255,255,255,0.12)",
	},
	strip: { gap: STRIP_GAP, paddingHorizontal: 4, paddingVertical: 4 },
	stripItem: { borderRadius: 9, borderWidth: 2, padding: 1 },
	stripCurrent: { borderColor: "#FFFFFF", opacity: 1 },
	stripOther: { borderColor: "transparent", opacity: 0.55 },
	center: {
		position: "absolute",
		top: 0,
		right: 0,
		bottom: 0,
		left: 0,
		alignItems: "center",
		justifyContent: "center",
		padding: 24,
	},
	missing: {
		maxWidth: 300,
		alignItems: "center",
		gap: 12,
		paddingHorizontal: 24,
		paddingVertical: 28,
		borderRadius: 16,
		backgroundColor: "rgba(255,255,255,0.06)",
	},
	degraded: { position: "absolute", left: 0, right: 0, bottom: 12, alignItems: "center" },
	degradedPill: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		maxWidth: "90%",
		paddingHorizontal: 12,
		paddingVertical: 7,
		borderRadius: 999,
		backgroundColor: "rgba(0,0,0,0.7)",
	},
	modeRow: { alignItems: "center", paddingHorizontal: 16, paddingBottom: 12 },
	modeGroup: {
		flexDirection: "row",
		padding: 4,
		borderRadius: 999,
		backgroundColor: "rgba(255,255,255,0.12)",
	},
	modeOption: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		minHeight: 38,
		paddingHorizontal: 14,
		borderRadius: 999,
	},
	modeSelected: { backgroundColor: "#FFFFFF" },
	stagePad: { paddingHorizontal: 8 },
	stage: { alignItems: "center", justifyContent: "center", gap: 10 },
	sideRow: { flexDirection: "row", gap: SIDE_GAP },
	overlayFrame: { overflow: "hidden", borderRadius: 12 },
	clip: { position: "absolute", top: 0, bottom: 0, right: 0, overflow: "hidden" },
	clipInner: { position: "absolute", top: 0, bottom: 0 },
	divider: {
		position: "absolute",
		top: 0,
		bottom: 0,
		width: 2,
		backgroundColor: "#FFFFFF",
	},
	knob: {
		position: "absolute",
		width: 32,
		height: 32,
		borderRadius: 16,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "#FFFFFF",
		shadowColor: "#000000",
		shadowOpacity: 0.3,
		shadowRadius: 6,
		shadowOffset: { width: 0, height: 2 },
		elevation: 4,
	},
	tag: {
		position: "absolute",
		top: 8,
		paddingHorizontal: 9,
		paddingVertical: 4,
		borderRadius: 999,
		backgroundColor: "rgba(0,0,0,0.65)",
	},
	slider: { height: 44, justifyContent: "center" },
	sliderTrack: {
		position: "absolute",
		left: 0,
		right: 0,
		height: 4,
		borderRadius: 2,
		backgroundColor: "rgba(255,255,255,0.3)",
	},
	sliderFill: {
		position: "absolute",
		left: 0,
		height: 4,
		borderRadius: 2,
		backgroundColor: "#FFFFFF",
	},
	sliderThumb: {
		position: "absolute",
		width: 24,
		height: 24,
		borderRadius: 12,
		backgroundColor: "#FFFFFF",
		shadowColor: "#000000",
		shadowOpacity: 0.3,
		shadowRadius: 4,
		shadowOffset: { width: 0, height: 1 },
		elevation: 3,
	},
});
