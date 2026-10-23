import { useBlobUrl } from "@/lib/blob-store";
import { useT } from "@/lib/messages";
import { syncController } from "@/lib/sync";
import { cn } from "@/lib/utils";
import type { AttachmentRef } from "@atomic/core";
import { useSyncState } from "@atomic/core/react";
import { CloudDownload, ImageOff, MonitorSmartphone } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { trackerCaps } from "./caps";

/**
 * Where a photo's pixels come from on this device (spec §5.8, Annex K §1.11).
 * - `ready`: an object URL (the thumbnail, or the full image for `full`);
 *   `degraded` when only the other size is here (a blurry stand-in).
 * - `loading`: reading the store, or downloading from the account.
 * - `missing`: not here. `where` says why: blob sync is on and it simply
 *   hasn't arrived (`device`: "Photo not on this device yet"), there is no
 *   blob sync (`elsewhere`: "On another device"), or this build has no
 *   photos at all (`off`: the artifact).
 */
export interface PhotoSource {
	src: string | null;
	status: "loading" | "ready" | "missing";
	degraded: boolean;
	where: "device" | "elsewhere" | "off";
	/** An `<img>` failed to load its object URL (revoked meanwhile): look again. */
	onError(): void;
}

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
	if (!on) return { src: null, status: "missing", degraded: false, where, onError: () => {} };
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
		return { src: null, status: "loading", degraded: false, where, onError: () => {} };
	}
	return { src: null, status: "missing", degraded: false, where, onError: () => {} };
}

/** The placeholder copy for a photo that isn't here (short for tiles, long for the viewer). */
export function missingPhotoText(
	where: PhotoSource["where"],
	t: ReturnType<typeof useT>["t"],
	long = false,
): string {
	if (where === "off") return t("tracker.photosOff");
	if (where === "device") return t("tracker.photoUnavailable");
	return long ? t("tracker.photo.onAnotherDevice") : t("tracker.photoElsewhere");
}

export function MissingPhotoIcon({
	where,
	className,
}: {
	where: PhotoSource["where"];
	className?: string;
}) {
	const Icon =
		where === "device" ? CloudDownload : where === "elsewhere" ? MonitorSmartphone : ImageOff;
	return <Icon aria-hidden="true" className={className} />;
}

export interface PhotoThumbProps {
	photo: AttachmentRef;
	/** Describes the photo (`photoAlt`). */
	alt: string;
	/** Square edge in px; without it the thumbnail fills its box (square). */
	size?: number;
	/** Makes it a button (opens the viewer); its name is `label`, else `alt`. */
	onClick?(): void;
	label?: string;
	/** Placeholder with words, not just an icon (tiles of 96 px and up). */
	verbose?: boolean;
	/** Shown over the bottom of the photo (a gallery's day), decorative. */
	caption?: string;
	/** `full`: the original (a large tile, then-and-now), else the 320 px thumbnail. */
	variant?: "thumb" | "full";
	/** CSS aspect ratio of a box without `size` (default square). */
	ratio?: string;
	className?: string;
}

/**
 * A square photo thumbnail from this device's blob store, with the designed
 * placeholders when the photo isn't here: "Photo not on this device yet"
 * (it can still download), "On another device" (no photo backup), or
 * "Photos aren't available in this version" (artifact). Owner: T4.
 */
export function PhotoThumb({
	photo,
	alt,
	size,
	onClick,
	label,
	verbose,
	caption,
	variant = "thumb",
	ratio,
	className,
}: PhotoThumbProps) {
	const { t } = useT();
	const source = usePhotoSource(photo, variant);
	const missing = source.status === "missing";
	const missingText = missing ? missingPhotoText(source.where, t) : null;
	const style: CSSProperties | undefined = size
		? { width: size, height: size }
		: ratio
			? { aspectRatio: ratio }
			: undefined;
	const box = cn(
		"relative grid shrink-0 place-items-center overflow-hidden rounded-md bg-sunken text-ink-subtle",
		!size && "w-full",
		!size && !ratio && "aspect-square",
		className,
	);
	const content = (
		<>
			{source.src ? (
				<img
					src={source.src}
					alt=""
					decoding="async"
					draggable={false}
					onError={source.onError}
					className="size-full object-cover"
				/>
			) : source.status === "loading" ? (
				<span
					aria-hidden="true"
					className="size-full animate-pulse bg-line/60 motion-reduce:animate-none"
				/>
			) : (
				<span className="flex flex-col items-center gap-1 px-1.5 text-center">
					<MissingPhotoIcon
						where={source.where}
						className={verbose ? "size-5 shrink-0" : "size-[38%] max-h-6 max-w-6 shrink-0"}
					/>
					{verbose ? (
						<span className="line-clamp-3 text-[11px] text-ink-muted leading-tight">
							{missingText}
						</span>
					) : null}
				</span>
			)}
			{caption && source.src ? (
				<span
					aria-hidden="true"
					className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-1.5 pt-4 pb-1 text-left font-medium text-[11px] text-white leading-tight"
				>
					{caption}
				</span>
			) : null}
		</>
	);
	// The accessible name carries the placeholder ("…, On another device") when there's no image.
	const name = [label ?? alt, missingText].filter(Boolean).join(" · ");
	if (onClick) {
		return (
			<button
				type="button"
				aria-label={name}
				title={missingText ?? undefined}
				onClick={onClick}
				style={style}
				className={cn(
					box,
					"transition-[box-shadow,transform] duration-(--atomic-duration-fast) hover:ring-2 hover:ring-line-strong active:scale-[0.98] motion-reduce:active:scale-100",
				)}
			>
				{content}
			</button>
		);
	}
	return (
		<span
			role="img"
			aria-label={[alt, missingText].filter(Boolean).join(" · ")}
			title={missingText ?? undefined}
			style={style}
			className={box}
		>
			{content}
		</span>
	);
}
