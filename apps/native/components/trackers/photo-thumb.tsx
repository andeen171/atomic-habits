import { CloudDownload, ImageOff, MonitorSmartphone } from "@/components/icons";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { blobStore, subscribeBlobs } from "@/lib/blob-store";
import type { AppTranslator } from "@/lib/i18n";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { syncController } from "@/lib/sync";
import { makeStyles, useTheme } from "@/lib/theme";
import type { AttachmentRef } from "@atomic/core";
import { useSyncState } from "@atomic/core/react";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
	cancelAnimation,
	useAnimatedStyle,
	useSharedValue,
	withRepeat,
	withTiming,
} from "react-native-reanimated";
import { trackerCaps } from "./caps";

/**
 * Photo thumbnails and where their pixels come from (spec §5.8/§6, Annex K
 * §1.11): this device's blob store, with the designed placeholders when a
 * photo isn't here. The native twin of web `photo-thumb.tsx`. Owner: T4.
 */

// ── Blob URIs ─────────────────────────────────────────────────────────────

/** Display URIs already looked up, so a remounting thumbnail draws at once (no placeholder flash). */
const known = new Map<string, string>();

subscribeBlobs((sha) => known.delete(sha));

export type BlobUrlState =
	| { status: "loading"; url: null }
	| { status: "ready"; url: string }
	| { status: "missing"; url: null };

/**
 * The display URI of a blob on this device, following writes and deletes.
 * `retry()` (an image's `onError`) forgets the URI and looks again.
 */
export function useBlobUrl(sha: string | null | undefined): BlobUrlState & { retry(): void } {
	const initial = (): BlobUrlState => {
		if (!sha) return { status: "missing", url: null };
		const url = known.get(sha);
		return url ? { status: "ready", url } : { status: "loading", url: null };
	};
	const [state, setState] = useState<BlobUrlState>(initial);
	const [attempt, setAttempt] = useState(0);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the lookup after a failed load.
	useEffect(() => {
		if (!sha) {
			setState({ status: "missing", url: null });
			return;
		}
		let alive = true;
		const look = () => {
			void blobStore.url(sha).then((url) => {
				if (!alive) return;
				if (url) known.set(sha, url);
				setState((current) =>
					url
						? current.url === url
							? current
							: { status: "ready", url }
						: { status: "missing", url: null },
				);
			});
		};
		// A different photo starts from its own state, never from the previous one's image.
		setState(initial());
		look();
		const unsubscribe = subscribeBlobs((changed) => {
			if (changed === sha) look();
		});
		return () => {
			alive = false;
			unsubscribe();
		};
	}, [sha, attempt]);
	const retry = useCallback(() => {
		if (!sha) return;
		known.delete(sha);
		setAttempt((n) => (n < 2 ? n + 1 : n));
	}, [sha]);
	return { ...state, retry };
}

/**
 * Where a photo's pixels come from on this device.
 * - `ready`: a file URI (the thumbnail, or the original for `full`);
 *   `degraded` when only the other size is here (a blurred stand-in).
 * - `loading`: reading the store, or downloading from the account.
 * - `missing`: not here. `where` says why: blob sync is on and it hasn't
 *   arrived (`device`: "Photo not on this device yet"), there is no blob
 *   sync (`elsewhere`: "On another device"), or photos are off (`off`).
 */
export interface PhotoSource {
	src: string | null;
	status: "loading" | "ready" | "missing";
	degraded: boolean;
	where: "device" | "elsewhere" | "off";
	/** The image failed to load its URI: look again. */
	onError(): void;
}

const noop = () => {};

export function usePhotoSource(ref: AttachmentRef | null, variant: "thumb" | "full"): PhotoSource {
	const caps = useMemo(() => trackerCaps(), []);
	const sync = useSyncState(syncController);
	const backup = caps.photos && sync.blobs !== null;
	const on = caps.photos && ref !== null;
	const mainSha = on ? (variant === "full" ? ref.hash : ref.thumb) : null;
	const otherSha = on ? (variant === "full" ? ref.thumb : ref.hash) : null;
	const main = useBlobUrl(mainSha);
	const other = useBlobUrl(main.status === "missing" && otherSha !== mainSha ? otherSha : null);
	const [fetching, setFetching] = useState<string | null>(null);
	const [tried, setTried] = useState<string | null>(null);

	// Not here but backed up: fetch it from the account (thumbnails also arrive with sync rounds).
	useEffect(() => {
		if (!backup || !mainSha || main.status !== "missing" || tried === mainSha) return;
		let alive = true;
		setTried(mainSha);
		setFetching(mainSha);
		void syncController.ensureBlob(mainSha).finally(() => {
			if (alive) setFetching(null);
		});
		return () => {
			alive = false;
		};
	}, [backup, mainSha, main.status, tried]);

	const where = !caps.photos ? "off" : backup ? "device" : "elsewhere";
	if (!on) return { src: null, status: "missing", degraded: false, where, onError: noop };
	if (main.status === "ready") {
		return { src: main.url, status: "ready", degraded: false, where, onError: main.retry };
	}
	const waiting =
		main.status === "loading" || fetching === mainSha || (backup && tried !== mainSha);
	if (other.status === "ready") {
		return {
			src: other.url,
			status: waiting && variant === "thumb" ? "loading" : "ready",
			degraded: variant === "full",
			where,
			onError: other.retry,
		};
	}
	if (waiting || other.status === "loading") {
		return { src: null, status: "loading", degraded: false, where, onError: noop };
	}
	return { src: null, status: "missing", degraded: false, where, onError: noop };
}

/** The placeholder copy for a photo that isn't here (short for tiles, long for the viewer). */
export function missingPhotoText(
	where: PhotoSource["where"],
	t: AppTranslator,
	long = false,
): string {
	if (where === "off") return t.t("tracker.photosOff");
	if (where === "device") return t.t("tracker.photoUnavailable");
	return long ? t.t("tracker.photo.onAnotherDevice") : t.t("tracker.photoElsewhere");
}

export function MissingPhotoIcon({
	where,
	size,
	color,
}: {
	where: PhotoSource["where"];
	size: number;
	color: string;
}) {
	const Icon =
		where === "device" ? CloudDownload : where === "elsewhere" ? MonitorSmartphone : ImageOff;
	return <Icon size={size} color={color} strokeWidth={1.8} />;
}

/** A quiet shimmer while a photo is read or downloaded (still under reduced motion). */
export function LoadingFill({ color }: { color: string }) {
	const reduceMotion = useReduceMotion();
	const pulse = useSharedValue(0.55);
	useEffect(() => {
		if (reduceMotion) return;
		pulse.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
		return () => cancelAnimation(pulse);
	}, [reduceMotion, pulse]);
	const style = useAnimatedStyle(() => ({ opacity: reduceMotion ? 0.7 : pulse.value }));
	return (
		<Animated.View
			pointerEvents="none"
			style={[StyleSheet.absoluteFill, { backgroundColor: color }, style]}
		/>
	);
}

// ── The thumbnail ─────────────────────────────────────────────────────────

export interface PhotoThumbProps {
	photo: AttachmentRef;
	/** Describes the photo (`photoAlt`). */
	alt: string;
	/** Square edge in points; without it the thumbnail fills its width at `ratio`. */
	size?: number;
	/** Width ÷ height of a box without `size` (default square). */
	ratio?: number;
	/** Makes it a button (opens the viewer); its name is `label`, else `alt`. */
	onPress?(): void;
	label?: string;
	/** Placeholder with words, not just an icon (tiles of 96 pt and up). */
	verbose?: boolean;
	/** Shown over the bottom of the photo (a gallery's day); decorative. */
	caption?: string;
	/** `full`: the original (a large tile, then and now), else the 320 px thumbnail. */
	variant?: "thumb" | "full";
	radius?: number;
	/** On black (the viewer's filmstrip): the placeholder in white tones. */
	onDark?: boolean;
	/** Part of a larger control that names it (a stack of an entry's photos). */
	decorative?: boolean;
	style?: StyleProp<ViewStyle>;
	testID?: string;
}

/**
 * A photo thumbnail from this device's blob store, with the designed
 * placeholders when the photo isn't here: "Photo not on this device yet"
 * (it can still download), "On another device" (no photo backup), or
 * "Photos aren't available in this version". Pressable thumbnails are image
 * buttons with a ≥ 44 pt target.
 */
export function PhotoThumb({
	photo,
	alt,
	size,
	ratio,
	onPress,
	label,
	verbose,
	caption,
	variant = "thumb",
	radius,
	onDark,
	decorative,
	style,
	testID,
}: PhotoThumbProps) {
	const t = useT();
	const { colors, radii } = useTheme();
	const styles = useStyles();
	const source = usePhotoSource(photo, variant);
	const missing = source.status === "missing";
	const missingText = missing ? missingPhotoText(source.where, t) : null;
	const box: ViewStyle = {
		borderRadius: radius ?? radii.md,
		backgroundColor: onDark ? "rgba(255,255,255,0.1)" : colors.sunken,
		...(size ? { width: size, height: size } : { width: "100%", aspectRatio: ratio ?? 1 }),
	};
	const iconColor = onDark ? "rgba(255,255,255,0.75)" : colors.textSubtle;
	const content = (
		<>
			{source.src ? (
				<Image
					source={{ uri: source.src }}
					style={StyleSheet.absoluteFill}
					resizeMode="cover"
					blurRadius={source.degraded ? 2 : 0}
					onError={source.onError}
					accessibilityIgnoresInvertColors
				/>
			) : source.status === "loading" ? (
				<LoadingFill color={onDark ? "rgba(255,255,255,0.12)" : colors.border} />
			) : (
				<View style={styles.missing}>
					<MissingPhotoIcon
						where={source.where}
						size={verbose ? 20 : Math.max(14, Math.min(24, Math.round((size ?? 64) * 0.38)))}
						color={iconColor}
					/>
					{verbose ? (
						<Text
							variant="tiny"
							align="center"
							numberOfLines={3}
							color={onDark ? "rgba(255,255,255,0.85)" : colors.textMuted}
						>
							{missingText}
						</Text>
					) : null}
				</View>
			)}
			{caption && source.src ? (
				<LinearGradient
					colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.62)"]}
					style={styles.caption}
					pointerEvents="none"
				>
					<Text variant="tiny" weight="semibold" color="#FFFFFF" numberOfLines={1}>
						{caption}
					</Text>
				</LinearGradient>
			) : null}
		</>
	);
	if (decorative) {
		return (
			<View
				style={[styles.box, box, style]}
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				testID={testID}
			>
				{content}
			</View>
		);
	}
	// The name carries the placeholder ("…, On another device") when there's no image.
	const name = [label ?? alt, missingText].filter(Boolean).join(" · ");
	if (onPress) {
		const edge = size ?? 44;
		return (
			<PressableScale
				onPress={onPress}
				scaleTo={0.96}
				hitSlop={Math.max(0, (44 - edge) / 2)}
				accessibilityRole="imagebutton"
				accessibilityLabel={name}
				style={[styles.box, box, style]}
				testID={testID}
			>
				{content}
			</PressableScale>
		);
	}
	return (
		<View
			style={[styles.box, box, style]}
			accessible
			accessibilityRole="image"
			accessibilityLabel={[alt, missingText].filter(Boolean).join(" · ")}
			testID={testID}
		>
			{content}
		</View>
	);
}

const useStyles = makeStyles(() => ({
	box: { overflow: "hidden", alignItems: "center", justifyContent: "center" },
	missing: { alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 6 },
	caption: {
		position: "absolute",
		left: 0,
		right: 0,
		bottom: 0,
		paddingHorizontal: 6,
		paddingTop: 16,
		paddingBottom: 5,
	},
}));
