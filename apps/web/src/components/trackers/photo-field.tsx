import { announce } from "@/lib/announce";
import { PhotoError, looksLikeImage, savePhoto } from "@/lib/image";
import { useT } from "@/lib/messages";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import type { AttachmentRef, DayKey } from "@atomic/core";
import { Camera, ImagePlus, LoaderCircle, X } from "lucide-react";
import {
	type ChangeEvent,
	type DragEvent,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { PhotoThumb } from "./photo-thumb";
import { useTrackerUI } from "./tracker-ui";

/**
 * The composer's photo control (Annex K §1.11, §4.1; spec §5.8): take a photo
 * (phones go straight to the camera), choose some, drop or paste them. Each
 * one is resized, re-encoded (EXIF and GPS dropped) and kept in this device's
 * blob store before it joins the entry, so the entry only holds references.
 * Thumbnails open the viewer; × removes one. The field label, hint and error
 * come from the composer's `FieldShell`. Owner: T4.
 */
export interface PhotoPickerProps {
	value: readonly AttachmentRef[];
	onChange(value: AttachmentRef[]): void;
	max: number;
	/** The entry's day, for alt text ("Photo from Oct 3"). */
	day?: DayKey;
	disabled?: boolean;
	/** The field's label and note, for the controls' accessible names. */
	labelId: string;
	describedBy?: string;
	invalid?: true;
	/** True while photos are being prepared (the composer holds Save). */
	onBusyChange?(busy: boolean): void;
	/** The first control takes focus when the composer opens (photo journal). */
	autoFocus?: boolean;
}

interface Pending {
	id: number;
}

let nextPending = 1;

export function PhotoPicker({
	value,
	onChange,
	max,
	day,
	disabled,
	labelId,
	describedBy,
	invalid,
	onBusyChange,
	autoFocus,
}: PhotoPickerProps) {
	const { t } = useT();
	const openViewer = useTrackerUI((s) => s.openViewer);
	const touch = useMediaQuery("(pointer: coarse)");
	const rootRef = useRef<HTMLDivElement>(null);
	const libraryRef = useRef<HTMLInputElement>(null);
	const cameraRef = useRef<HTMLInputElement>(null);
	const hintId = useId();
	const [pending, setPending] = useState<Pending[]>([]);
	const [dragging, setDragging] = useState(false);
	// The latest value: photos finish one after another, each adds to what is there by then.
	const latest = useRef(value);
	useLayoutEffect(() => {
		latest.current = value;
	});
	const busy = pending.length > 0;
	const room = Math.max(0, max - value.length - pending.length);

	useEffect(() => {
		onBusyChange?.(busy);
	}, [busy, onBusyChange]);
	useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

	const add = async (files: readonly File[]) => {
		if (disabled || files.length === 0) return;
		const images = files.filter(looksLikeImage);
		if (images.length < files.length && images.length === 0) {
			toast.error(t("tracker.photoUnsupported"));
			return;
		}
		const taken = images.slice(0, room);
		if (images.length > taken.length) toast(t("tracker.photo.limit", { max: t.number(max) }));
		if (taken.length === 0) return;
		const slots = taken.map(() => ({ id: nextPending++ }));
		setPending((current) => [...current, ...slots]);
		let added = 0;
		// One at a time: decoding several 12 MP photos at once can exhaust a phone's memory.
		for (const [i, file] of taken.entries()) {
			const slot = slots[i] as Pending;
			try {
				const ref = await savePhoto(file);
				const current = latest.current;
				if (!current.some((photo) => photo.hash === ref.hash)) {
					const next = [...current, ref];
					latest.current = next;
					onChange(next);
					added++;
				}
			} catch (error) {
				const code = error instanceof PhotoError ? error.code : "unsupported";
				toast.error(
					t(
						code === "too-large"
							? "tracker.photo.tooLarge"
							: code === "save-failed"
								? "tracker.photo.saveFailed"
								: "tracker.photoUnsupported",
					),
				);
			} finally {
				setPending((current) => current.filter((p) => p.id !== slot.id));
			}
		}
		if (added > 0) announce(t.tp("tracker.photo.added", added));
	};

	const onPick = (event: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.target.files ?? []);
		// Picking the same file again must fire `change` again.
		event.target.value = "";
		void add(files);
	};

	// Paste an image (a screenshot, a copied photo) anywhere in the composer.
	useEffect(() => {
		if (disabled) return;
		const onPaste = (event: ClipboardEvent) => {
			const root = rootRef.current;
			const scope = root?.closest('[role="dialog"]') ?? root;
			if (!scope || !(event.target instanceof Node) || !scope.contains(event.target)) return;
			const files = Array.from(event.clipboardData?.files ?? []).filter(looksLikeImage);
			if (files.length === 0) return;
			event.preventDefault();
			void add(files);
		};
		document.addEventListener("paste", onPaste);
		return () => document.removeEventListener("paste", onPaste);
	});

	const remove = (index: number) => {
		const next = value.filter((_, i) => i !== index);
		onChange(next);
		latest.current = next;
		announce(t("tracker.photo.removed"));
		// Focus stays in the field: the next photo's ×, else the previous one's, else add.
		requestAnimationFrame(() => {
			const root = rootRef.current;
			const buttons = root?.querySelectorAll<HTMLElement>("[data-photo-remove]");
			const target =
				buttons?.[Math.min(index, (buttons?.length ?? 1) - 1)] ??
				root?.querySelector<HTMLElement>("[data-photo-add]");
			target?.focus();
		});
	};

	const view = (index: number) =>
		openViewer({
			mode: "photos",
			habitId: null,
			index,
			photos: value.map((ref) => ({ ref, day: day ?? "", caption: null, entryId: null })),
		});

	const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
	const dropProps = disabled
		? {}
		: {
				onDragEnter: (event: DragEvent) => {
					if (!hasFiles(event)) return;
					event.preventDefault();
					setDragging(true);
				},
				onDragOver: (event: DragEvent) => {
					if (!hasFiles(event)) return;
					event.preventDefault();
					event.dataTransfer.dropEffect = room > 0 ? "copy" : "none";
				},
				onDragLeave: (event: DragEvent) => {
					if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
					setDragging(false);
				},
				onDrop: (event: DragEvent) => {
					if (!hasFiles(event)) return;
					event.preventDefault();
					setDragging(false);
					void add(Array.from(event.dataTransfer.files));
				},
			};

	const inputs = (
		<>
			<input
				ref={libraryRef}
				type="file"
				accept="image/*"
				multiple={max - value.length > 1}
				hidden
				tabIndex={-1}
				onChange={onPick}
			/>
			<input
				ref={cameraRef}
				type="file"
				accept="image/*"
				capture="environment"
				hidden
				tabIndex={-1}
				onChange={onPick}
			/>
		</>
	);
	const describe = [describedBy, hintId].filter(Boolean).join(" ") || undefined;
	const hint = (
		<p id={hintId} className="text-ink-subtle text-tiny">
			{t("tracker.photo.privacyHint")}
		</p>
	);

	// Nothing yet: one generous target (take / choose / drop).
	if (value.length === 0 && !busy) {
		return (
			<div ref={rootRef} className="flex flex-col gap-1.5" {...dropProps}>
				{inputs}
				<div
					className={cn(
						"flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-5 text-center transition-colors duration-(--atomic-duration-fast)",
						dragging
							? "border-accent bg-accent-soft"
							: invalid
								? "border-danger bg-danger-soft/40"
								: "border-line-strong bg-sunken/50",
					)}
				>
					<span
						aria-hidden="true"
						className="grid size-12 place-items-center rounded-full bg-surface text-ink-muted shadow-card"
					>
						<Camera className="size-6" />
					</span>
					<div className="flex flex-wrap items-center justify-center gap-2">
						{touch ? (
							<Button
								variant="soft"
								disabled={disabled}
								data-autofocus={autoFocus ? "" : undefined}
								aria-describedby={describe}
								aria-invalid={invalid}
								onClick={() => cameraRef.current?.click()}
							>
								<Camera />
								{t("tracker.photo.take")}
							</Button>
						) : null}
						<Button
							variant={touch ? "secondary" : "soft"}
							disabled={disabled}
							data-photo-add=""
							data-autofocus={autoFocus && !touch ? "" : undefined}
							aria-describedby={describe}
							aria-invalid={invalid}
							onClick={() => libraryRef.current?.click()}
						>
							<ImagePlus />
							{t(max > 1 ? "tracker.photo.choose" : "tracker.photo.chooseOne")}
						</Button>
					</div>
					{touch ? null : (
						<p className="text-ink-subtle text-small">{t("tracker.photo.dropHint")}</p>
					)}
				</div>
				{hint}
			</div>
		);
	}

	return (
		<div ref={rootRef} className="flex flex-col gap-1.5" {...dropProps}>
			{inputs}
			<ul
				aria-labelledby={labelId}
				aria-describedby={describe}
				aria-busy={busy || undefined}
				className={cn(
					"grid grid-cols-4 gap-2 rounded-xl transition-[box-shadow,background-color] duration-(--atomic-duration-fast)",
					dragging && "bg-accent-soft ring-2 ring-accent ring-offset-4 ring-offset-surface",
				)}
			>
				{value.map((photo, index) => {
					const label = t("tracker.photo.open", {
						index: t.number(index + 1),
						total: t.number(value.length),
					});
					return (
						<li key={photo.hash} className="relative">
							<PhotoThumb photo={photo} alt={label} label={label} onClick={() => view(index)} />
							{disabled ? null : (
								<button
									type="button"
									data-photo-remove=""
									aria-label={t("tracker.photo.remove", { index: t.number(index + 1) })}
									onClick={() => remove(index)}
									className="absolute top-1 right-1 grid pointer-coarse:size-8 size-7 place-items-center rounded-full bg-black/60 text-white shadow-sm transition-colors hover:bg-black/80"
								>
									<X aria-hidden="true" className="size-4" />
								</button>
							)}
						</li>
					);
				})}
				{pending.map((slot) => (
					<li
						key={`pending-${slot.id}`}
						className="grid aspect-square place-items-center rounded-md bg-sunken text-ink-subtle"
					>
						<LoaderCircle
							aria-hidden="true"
							className="size-6 animate-spin motion-reduce:animate-none"
						/>
						<span className="sr-only">{t("tracker.photo.preparing")}</span>
					</li>
				))}
				{room > 0 && !disabled ? (
					<li>
						<button
							type="button"
							data-photo-add=""
							aria-label={t("tracker.photo.addMore")}
							title={t("tracker.photo.addMore")}
							onClick={() => libraryRef.current?.click()}
							className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-md border border-line-strong border-dashed bg-sunken/40 text-ink-muted transition-colors hover:border-ink-subtle hover:bg-hover hover:text-ink"
						>
							<ImagePlus aria-hidden="true" className="size-5" />
							<span className="hidden px-1 text-center text-tiny leading-tight sm:block">
								{t("tracker.photo.addMore")}
							</span>
						</button>
					</li>
				) : null}
			</ul>
			{busy ? (
				<p aria-live="polite" className="text-ink-muted text-tiny">
					{t("tracker.photo.preparing")}
				</p>
			) : (
				hint
			)}
		</div>
	);
}
