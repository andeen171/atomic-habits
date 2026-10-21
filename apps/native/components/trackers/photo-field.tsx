import { Camera, ImagePlus, type LucideIcon, X } from "@/components/icons";
import { ActionList } from "@/components/sheet/action-list";
import { Sheet } from "@/components/sheet/sheet";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { type AppTranslator, useT } from "@/lib/i18n";
import { PhotoError, type PickedImage, pickImages, savePhoto } from "@/lib/image";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import { afterSheet } from "@/lib/use-tracker-actions";
import type { AttachmentRef, DayKey } from "@atomic/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Linking, View } from "react-native";
import { PhotoThumb } from "./photo-thumb";
import { trackerUI } from "./tracker-ui";

/**
 * The composer's photo control (Annex K §1.11, §5.1; spec §6): take a photo
 * or choose some from the library (`expo-image-picker`; the camera asks for
 * permission the first time). Each one is resized, re-encoded (EXIF and GPS
 * dropped) and kept in this device's blob store before it joins the entry,
 * so the entry only holds references. Thumbnails open the viewer; × removes
 * one; the "Add photo" tile offers the camera or the library in a sheet.
 * The label, hint and error come from the composer's field shell. Owner: T4.
 */
export interface PhotoPickerProps {
	value: readonly AttachmentRef[];
	onChange(value: AttachmentRef[]): void;
	max: number;
	/** The entry's day (the viewer's date line). */
	day?: DayKey;
	/** The field has an error: the empty target is outlined in the danger color. */
	invalid?: boolean;
	/** True while photos are being prepared (the composer holds Save). */
	onBusyChange?(busy: boolean): void;
}

const GAP = 8;
const COLUMNS = 4;

let nextSlot = 1;

const announce = (message: string) => AccessibilityInfo.announceForAccessibility(message);

export function PhotoPicker({
	value,
	onChange,
	max,
	day,
	invalid,
	onBusyChange,
}: PhotoPickerProps) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const [pending, setPending] = useState<number[]>([]);
	const [menu, setMenu] = useState(false);
	const [width, setWidth] = useState(0);
	// The latest value: photos finish one after another, each adds to what is there by then.
	const latest = useRef(value);
	useLayoutEffect(() => {
		latest.current = value;
	});
	const pendingCount = useRef(0);
	pendingCount.current = pending.length;
	const busy = pending.length > 0;
	const room = Math.max(0, max - value.length - pending.length);

	useEffect(() => {
		onBusyChange?.(busy);
	}, [busy, onBusyChange]);
	useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

	const limit = () => showToast(t.t("tracker.photo.limit", { max: t.number(max) }));

	const add = async (source: "camera" | "library") => {
		const space = Math.max(0, max - latest.current.length - pendingCount.current);
		if (space === 0) {
			limit();
			return;
		}
		const images = await pickWithFeedback(source, space, t);
		if (!images) return;
		// Room again: photos may have finished (or been removed) while the picker was open.
		const left = Math.max(0, max - latest.current.length - pendingCount.current);
		const taken = images.slice(0, left);
		if (images.length > taken.length) limit();
		if (taken.length === 0) return;
		const slots = taken.map(() => nextSlot++);
		setPending((current) => [...current, ...slots]);
		pendingCount.current += slots.length;
		let added = 0;
		// One at a time: decoding several 12 MP photos at once can exhaust a phone's memory.
		for (const [i, image] of taken.entries()) {
			const slot = slots[i] as number;
			try {
				const ref = await savePhoto(image);
				const current = latest.current;
				if (!current.some((photo) => photo.hash === ref.hash)) {
					const next = [...current, ref];
					latest.current = next;
					onChange(next);
					added++;
				}
			} catch (error) {
				photoFailed(error, t);
			} finally {
				pendingCount.current -= 1;
				setPending((current) => current.filter((id) => id !== slot));
			}
		}
		if (added > 0) {
			haptics.light();
			announce(t.tp("tracker.photo.added", added));
		}
	};

	const choose = (source: "camera" | "library") => {
		haptics.selection();
		void add(source);
	};

	const fromMenu = (source: "camera" | "library") => void add(source);

	const remove = (index: number) => {
		const next = value.filter((_, i) => i !== index);
		latest.current = next;
		onChange(next);
		haptics.selection();
		announce(t.t("tracker.photo.removed"));
	};

	const view = (index: number) =>
		trackerUI.openViewer({
			mode: "photos",
			habitId: null,
			index,
			photos: value.map((ref) => ({ ref, day: day ?? "", caption: null, entryId: null })),
		});

	const hint = (
		<Text variant="tiny" tone="subtle">
			{t.t("tracker.photo.privacyHint")}
		</Text>
	);

	const menuSheet = (
		<PhotoSourceSheet
			open={menu}
			title={t.t("tracker.photo.addMore")}
			multiple={room > 1}
			onClose={() => setMenu(false)}
			onPick={fromMenu}
		/>
	);

	// Nothing yet: one generous target (take or choose).
	if (value.length === 0 && !busy) {
		return (
			<View style={styles.root}>
				<View
					style={[
						styles.empty,
						invalid && { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
					]}
				>
					<SourceTile
						icon={Camera}
						label={t.t("tracker.photo.take")}
						accent
						onPress={() => choose("camera")}
						testID="photo-take"
					/>
					<SourceTile
						icon={ImagePlus}
						label={t.t(max > 1 ? "tracker.photo.choose" : "tracker.photo.chooseOne")}
						onPress={() => choose("library")}
						testID="photo-choose"
					/>
				</View>
				{hint}
			</View>
		);
	}

	const tile = width > 0 ? Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS) : 0;
	return (
		<View style={styles.root}>
			<View
				style={styles.grid}
				onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
				accessibilityState={{ busy }}
			>
				{tile > 0 ? (
					<>
						{value.map((photo, index) => {
							const label = t.t("tracker.photo.open", {
								index: t.number(index + 1),
								total: t.number(value.length),
							});
							return (
								<View key={photo.hash} style={{ width: tile, height: tile }}>
									<PhotoThumb
										photo={photo}
										alt={label}
										label={label}
										size={tile}
										onPress={() => view(index)}
										testID="photo-field-thumb"
									/>
									<PressableScale
										onPress={() => remove(index)}
										scaleTo={0.9}
										hitSlop={8}
										accessibilityRole="button"
										accessibilityLabel={t.t("tracker.photo.remove", {
											index: t.number(index + 1),
										})}
										style={styles.remove}
										testID="photo-remove"
									>
										<X size={16} color="#FFFFFF" strokeWidth={2.4} />
									</PressableScale>
								</View>
							);
						})}
						{pending.map((slot) => (
							<View
								key={`pending-${slot}`}
								style={[styles.pending, { width: tile, height: tile }]}
								accessible
								accessibilityLabel={t.t("tracker.photo.preparing")}
							>
								<ActivityIndicator color={colors.textMuted} />
							</View>
						))}
						{room > 0 ? (
							<PressableScale
								onPress={() => {
									haptics.selection();
									setMenu(true);
								}}
								scaleTo={0.96}
								accessibilityRole="button"
								accessibilityLabel={t.t("tracker.photo.addMore")}
								style={[styles.addTile, { width: tile, height: tile }]}
								testID="photo-add"
							>
								<ImagePlus size={20} color={colors.textMuted} />
								<Text variant="tiny" tone="muted" align="center" numberOfLines={2}>
									{t.t("tracker.photo.addMore")}
								</Text>
							</PressableScale>
						) : null}
					</>
				) : null}
			</View>
			{busy ? (
				<Text variant="tiny" tone="muted" accessibilityLiveRegion="polite">
					{t.t("tracker.photo.preparing")}
				</Text>
			) : (
				hint
			)}
			{menuSheet}
		</View>
	);
}

/** One of the two big targets of an empty photo field: the camera, or the library. */
function SourceTile({
	icon: Icon,
	label,
	accent,
	onPress,
	testID,
}: {
	icon: LucideIcon;
	label: string;
	/** The lead action (the camera): an accent-tinted icon. */
	accent?: boolean;
	onPress(): void;
	testID?: string;
}) {
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<PressableScale
			onPress={onPress}
			scaleTo={0.97}
			accessibilityRole="button"
			accessibilityLabel={label}
			style={styles.sourceTile}
			testID={testID}
		>
			<View
				style={[styles.sourceIcon, { backgroundColor: accent ? colors.accentSoft : colors.sunken }]}
			>
				<Icon size={22} color={accent ? colors.accentText : colors.text} strokeWidth={2} />
			</View>
			<Text variant="small" weight="semibold" align="center" numberOfLines={2}>
				{label}
			</Text>
		</PressableScale>
	);
}

/**
 * Opens the camera or the library and says what went wrong, if anything: a
 * refused permission (with "Open settings" once only the settings can
 * grant it), a camera that won't open. Null when there's nothing to add.
 */
export async function pickWithFeedback(
	source: "camera" | "library",
	max: number,
	t: AppTranslator,
): Promise<PickedImage[] | null> {
	const result = await pickImages(source, max);
	if (result.status === "picked") return result.images.length > 0 ? result.images : null;
	if (result.status === "canceled") return null;
	haptics.warning();
	if (result.status === "denied") {
		showToast(
			t.t(source === "camera" ? "tracker.photo.cameraDenied" : "tracker.photo.libraryDenied"),
			{
				tone: "danger",
				duration: 6000,
				action: result.settings
					? {
							label: t.t("tracker.photo.openSettings"),
							onPress: () => void Linking.openSettings().catch(() => {}),
						}
					: undefined,
			},
		);
	} else {
		showToast(
			t.t(source === "camera" ? "tracker.photo.cameraFailed" : "tracker.photoUnsupported"),
			{ tone: "danger" },
		);
	}
	return null;
}

/** The toast for a photo that couldn't be kept (format, size, storage). */
export function photoFailed(error: unknown, t: AppTranslator): void {
	const code = error instanceof PhotoError ? error.code : "unsupported";
	haptics.warning();
	showToast(
		t.t(
			code === "too-large"
				? "tracker.photo.tooLarge"
				: code === "save-failed"
					? "tracker.photo.saveFailed"
					: "tracker.photoUnsupported",
		),
		{ tone: "danger" },
	);
}

/** Camera or library, as a small action sheet; the picker opens once the sheet has slid away. */
export function PhotoSourceSheet({
	open,
	title,
	multiple,
	onClose,
	onPick,
}: {
	open: boolean;
	title: string;
	/** "Choose photos" rather than "Choose photo". */
	multiple: boolean;
	onClose(): void;
	onPick(source: "camera" | "library"): void;
}) {
	const t = useT();
	const pick = (source: "camera" | "library") => {
		onClose();
		afterSheet(() => onPick(source));
	};
	return (
		<Sheet open={open} onClose={onClose} title={title}>
			<ActionList
				actions={[
					{
						key: "camera",
						label: t.t("tracker.photo.take"),
						icon: Camera,
						onPress: () => pick("camera"),
					},
					{
						key: "library",
						label: t.t(multiple ? "tracker.photo.choose" : "tracker.photo.chooseOne"),
						icon: ImagePlus,
						onPress: () => pick("library"),
					},
				]}
			/>
		</Sheet>
	);
}

const useStyles = makeStyles((t) => ({
	root: { gap: 8 },
	empty: {
		flexDirection: "row",
		gap: 10,
		padding: 10,
		borderRadius: t.radii.lg,
		borderWidth: 1.5,
		borderStyle: "dashed",
		borderColor: t.colors.borderStrong,
		backgroundColor: t.colors.bg,
	},
	sourceTile: {
		flex: 1,
		minWidth: 0,
		minHeight: 104,
		alignItems: "center",
		justifyContent: "center",
		gap: 8,
		paddingHorizontal: 8,
		paddingVertical: 14,
		borderRadius: t.radii.md,
		backgroundColor: t.colors.surface,
		...t.cardShadow,
	},
	sourceIcon: {
		width: 44,
		height: 44,
		borderRadius: 22,
		alignItems: "center",
		justifyContent: "center",
	},
	grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP, minHeight: 1 },
	remove: {
		position: "absolute",
		top: 5,
		right: 5,
		width: 28,
		height: 28,
		borderRadius: 14,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: "rgba(0,0,0,0.62)",
	},
	pending: {
		alignItems: "center",
		justifyContent: "center",
		borderRadius: t.radii.md,
		backgroundColor: t.colors.sunken,
	},
	addTile: {
		alignItems: "center",
		justifyContent: "center",
		gap: 4,
		paddingHorizontal: 4,
		borderRadius: t.radii.md,
		borderWidth: 1.5,
		borderStyle: "dashed",
		borderColor: t.colors.borderStrong,
		backgroundColor: t.colors.bg,
	},
}));
