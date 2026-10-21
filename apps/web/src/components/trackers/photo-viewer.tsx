import { blobStore } from "@/lib/blob-store";
import { useReturnFocus } from "@/lib/focus";
import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { type DayKey, diffDays, photoAlt } from "@atomic/core";
import { useHabit, useToday, useTracker } from "@atomic/core/react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Columns2, LoaderCircle, Pencil, X } from "lucide-react";
import {
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { MissingPhotoIcon, PhotoThumb, missingPhotoText, usePhotoSource } from "./photo-thumb";
import { type PhotoViewerState, type ViewerPhoto, useTrackerUI } from "./tracker-ui";

/**
 * The photo viewer (Annex K §4.1, §1.8.11): a full-screen lightbox over
 * black, mounted once in the tracker dialogs host and opened through
 * `useTrackerUI().openViewer`. Two modes:
 * - a timeline of photos (a period's gallery, an entry's photos): ‹ ›, the
 *   arrow keys, Home/End and a swipe move along it; a filmstrip shows where
 *   you are; "Edit entry" opens the photo's entry;
 * - then and now (progress photo): side by side, or one over the other
 *   with a slider.
 * The original downloads on demand when it isn't on this device (thumbnail
 * shown meanwhile), with the same placeholders as the thumbnails. Owner: T4.
 */
export function PhotoViewer() {
	const state = useTrackerUI((s) => s.viewer);
	const close = useTrackerUI((s) => s.closeViewer);
	// Keep the last state while the viewer fades out.
	const last = useRef<PhotoViewerState | null>(null);
	if (state) last.current = state;
	const shown = state ?? last.current;
	const focus = useReturnFocus({});
	const { t } = useT();
	return (
		<DialogPrimitive.Root open={state !== null} onOpenChange={(open) => !open && close()}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
				<DialogPrimitive.Content
					{...focus}
					aria-describedby={undefined}
					className="fixed inset-0 z-50 flex flex-col text-white outline-none data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in"
				>
					<DialogPrimitive.Title className="sr-only">
						{shown?.mode === "compare" ? t("tracker.photo.compare") : t("tracker.photo.viewer")}
					</DialogPrimitive.Title>
					{shown?.mode === "photos" ? (
						<TimelineView key={shown.photos.map((p) => p.ref.hash).join()} state={shown} />
					) : shown?.mode === "compare" ? (
						<CompareView state={shown} />
					) : null}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

/**
 * "Today", "Tuesday, March 3" (or "Mar 3" when `short`), with the year when
 * it isn't this one.
 */
function usePhotoDay(short = false) {
	const { t } = useT();
	const today = useToday();
	return (day: DayKey) => {
		if (!day) return "";
		const near = Math.abs(diffDays(day, today)) <= 1;
		const label = short && !near ? t.formatDayShort(day) : t.formatRelativeDay(day, today);
		return day.slice(0, 4) === today.slice(0, 4) ? label : `${label}, ${day.slice(0, 4)}`;
	};
}

function TopBar({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
	const { t } = useT();
	return (
		<div className="flex shrink-0 items-start gap-3 px-3 pt-[max(12px,env(safe-area-inset-top))] pb-2 md:px-5 md:pt-4">
			<div className="min-w-0 flex-1 pt-1.5 pl-1">{children}</div>
			<div className="flex shrink-0 items-center gap-1">
				{actions}
				<DialogPrimitive.Close
					aria-label={t("common.close")}
					className="grid size-11 place-items-center rounded-full text-white/85 transition-colors hover:bg-white/10 hover:text-white"
				>
					<X aria-hidden="true" className="size-6" />
				</DialogPrimitive.Close>
			</div>
		</div>
	);
}

/** "Edit entry" for a saved photo whose tracker can still be edited. */
function EditEntryButton({ habitId, photo }: { habitId: string | null; photo: ViewerPhoto }) {
	const { t } = useT();
	const habit = useHabit(habitId ?? undefined);
	const tracker = useTracker(habit);
	const close = useTrackerUI((s) => s.closeViewer);
	const openEntryComposer = useUI((s) => s.openEntryComposer);
	if (!habit || !tracker?.active || habit.archivedAt || !photo.entryId) return null;
	const entryId = photo.entryId;
	return (
		<button
			type="button"
			onClick={() => {
				close();
				openEntryComposer({ habitId: habit.id, day: photo.day, entryId });
			}}
			className="inline-flex h-11 items-center gap-2 rounded-full px-3.5 font-medium text-small text-white/90 transition-colors hover:bg-white/10 hover:text-white"
		>
			<Pencil aria-hidden="true" className="size-4" />
			<span className="hidden sm:inline">{t("tracker.editEntry")}</span>
			<span className="sr-only sm:hidden">{t("tracker.editEntry")}</span>
		</button>
	);
}

// ── Timeline ──────────────────────────────────────────────────────────────

function TimelineView({ state }: { state: Extract<PhotoViewerState, { mode: "photos" }> }) {
	const { t } = useT();
	const dayLabel = usePhotoDay();
	const { photos } = state;
	const [index, setIndex] = useState(() =>
		Math.min(Math.max(0, state.index), Math.max(0, photos.length - 1)),
	);
	const photo = photos[index];
	const swipe = useRef<{ x: number; y: number } | null>(null);
	const count = photos.length;

	// Warm the neighbours, so ‹ › shows them at once.
	useEffect(() => {
		for (const near of [photos[index - 1], photos[index + 1]]) {
			if (near) void blobStore.url(near.ref.hash);
		}
	}, [photos, index]);

	if (!photo) return null;
	const alt = photo.day
		? photoAlt(photo.ref, { date: photo.day, data: { caption: photo.caption } }, t)
		: t("tracker.photo.open", { index: t.number(index + 1), total: t.number(count) });
	const go = (next: number) => setIndex(Math.min(count - 1, Math.max(0, next)));
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.target instanceof HTMLInputElement) return;
		const keys: Record<string, number> = {
			ArrowLeft: index - 1,
			ArrowRight: index + 1,
			Home: 0,
			End: count - 1,
		};
		const target = keys[event.key];
		if (target === undefined || count < 2) return;
		event.preventDefault();
		go(target);
	};
	const onPointerDown = (event: PointerEvent) => {
		if (event.pointerType === "mouse") return;
		swipe.current = { x: event.clientX, y: event.clientY };
	};
	const onPointerUp = (event: PointerEvent) => {
		const start = swipe.current;
		swipe.current = null;
		if (!start) return;
		const dx = event.clientX - start.x;
		const dy = event.clientY - start.y;
		if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
		go(dx < 0 ? index + 1 : index - 1);
	};

	const position =
		count > 1
			? t("tracker.photo.position", { index: t.number(index + 1), total: t.number(count) })
			: null;
	return (
		<div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
			<TopBar actions={<EditEntryButton habitId={state.habitId} photo={photo} />}>
				<p aria-live="polite" className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
					{photo.day ? (
						<span className="font-semibold text-body text-white">{dayLabel(photo.day)}</span>
					) : null}
					{position ? (
						<span className="text-small text-white/70 tabular-nums">{position}</span>
					) : null}
				</p>
			</TopBar>
			<div
				className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center px-2 md:px-20"
				onPointerDown={onPointerDown}
				onPointerUp={onPointerUp}
				onPointerCancel={() => {
					swipe.current = null;
				}}
			>
				<FullPhoto key={photo.ref.hash} photo={photo} alt={alt} />
				{count > 1 ? (
					<>
						<NavButton
							side="left"
							label={t("tracker.photo.previous")}
							disabled={index === 0}
							onClick={() => go(index - 1)}
						/>
						<NavButton
							side="right"
							label={t("tracker.photo.next")}
							disabled={index === count - 1}
							onClick={() => go(index + 1)}
						/>
					</>
				) : null}
			</div>
			<div className="flex shrink-0 flex-col gap-3 px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] md:px-6">
				{photo.caption ? (
					<p className="mx-auto line-clamp-4 max-w-2xl whitespace-pre-line break-words text-center text-body text-white/90">
						{photo.caption}
					</p>
				) : null}
				{count > 1 ? <Filmstrip photos={photos} index={index} onPick={go} /> : null}
			</div>
		</div>
	);
}

function NavButton({
	side,
	label,
	disabled,
	onClick,
}: {
	side: "left" | "right";
	label: string;
	disabled: boolean;
	onClick(): void;
}) {
	const Icon = side === "left" ? ChevronLeft : ChevronRight;
	return (
		<button
			type="button"
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className={cn(
				"-translate-y-1/2 absolute top-1/2 hidden size-12 place-items-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-[background-color,opacity] hover:bg-white/20 disabled:pointer-events-none disabled:opacity-0 md:grid",
				side === "left" ? "left-4" : "right-4",
			)}
		>
			<Icon aria-hidden="true" className="size-7" />
		</button>
	);
}

/** The filmstrip: every photo of the set, in order, the current one ringed. */
function Filmstrip({
	photos,
	index,
	onPick,
}: {
	photos: readonly ViewerPhoto[];
	index: number;
	onPick(index: number): void;
}) {
	const { t } = useT();
	const dayLabel = usePhotoDay();
	const listRef = useRef<HTMLUListElement>(null);
	const labelId = useId();
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-centres the strip whenever the photo changes.
	useEffect(() => {
		const current = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		current?.scrollIntoView({
			block: "nearest",
			inline: "center",
			behavior: reduce ? "auto" : "smooth",
		});
	}, [index]);
	return (
		<nav aria-labelledby={labelId} className="mx-auto w-full max-w-3xl">
			<h2 id={labelId} className="sr-only">
				{t("tracker.photo.timeline")}
			</h2>
			<ul
				ref={listRef}
				className="flex gap-1.5 overflow-x-auto overscroll-x-contain px-1 py-1.5 [scrollbar-width:none] md:justify-center"
			>
				{photos.map((photo, i) => {
					const label = [
						t("tracker.photo.open", { index: t.number(i + 1), total: t.number(photos.length) }),
						photo.day ? dayLabel(photo.day) : null,
					]
						.filter(Boolean)
						.join(" · ");
					return (
						<li
							key={`${photo.ref.hash}:${i}`}
							aria-current={i === index ? "true" : undefined}
							className="shrink-0"
						>
							<PhotoThumb
								photo={photo.ref}
								alt={label}
								label={label}
								size={52}
								onClick={() => onPick(i)}
								className={cn(
									"rounded-sm bg-white/10 transition-opacity",
									i === index
										? "opacity-100 outline-2 outline-white outline-offset-2"
										: "opacity-55 hover:opacity-90",
								)}
							/>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}

/**
 * The original, or the thumbnail (blurred less than nothing at all) while it
 * downloads; the placeholder when it can't be had.
 */
function FullPhoto({
	photo,
	alt,
	fit = "contain",
	className,
}: {
	photo: ViewerPhoto;
	alt: string;
	fit?: "contain" | "cover";
	className?: string;
}) {
	const { t } = useT();
	const source = usePhotoSource(photo.ref, "full");
	const [loaded, setLoaded] = useState<string | null>(null);
	if (!source.src) {
		return source.status === "loading" ? (
			<output className="grid place-items-center text-white/70">
				<LoaderCircle
					aria-hidden="true"
					className="size-8 animate-spin motion-reduce:animate-none"
				/>
				<span className="sr-only">{t("tracker.photo.loading")}</span>
			</output>
		) : (
			<div
				role="img"
				aria-label={`${alt} · ${missingPhotoText(source.where, t, true)}`}
				className="flex max-w-xs flex-col items-center gap-3 rounded-xl bg-white/5 px-6 py-8 text-center"
			>
				<MissingPhotoIcon where={source.where} className="size-8 text-white/70" />
				<p className="text-body text-white/85">{missingPhotoText(source.where, t, true)}</p>
			</div>
		);
	}
	return (
		<span className={cn("relative flex size-full items-center justify-center", className)}>
			<img
				src={source.src}
				alt={alt}
				width={photo.ref.w}
				height={photo.ref.h}
				draggable={false}
				onLoad={() => setLoaded(source.src)}
				onError={source.onError}
				className={cn(
					"size-full select-none",
					fit === "cover" ? "object-cover" : "object-contain",
					source.degraded && "blur-[2px]",
					loaded === source.src ? "opacity-100" : "opacity-0",
					"transition-opacity duration-(--atomic-duration-base) motion-reduce:transition-none",
				)}
			/>
			{source.degraded ? (
				<span className="absolute inset-x-0 bottom-3 flex justify-center">
					<span className="inline-flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-small text-white">
						{source.status === "loading" ? (
							<LoaderCircle
								aria-hidden="true"
								className="size-4 animate-spin motion-reduce:animate-none"
							/>
						) : (
							<MissingPhotoIcon where={source.where} className="size-4" />
						)}
						{source.status === "loading"
							? t("tracker.photo.loading")
							: missingPhotoText(source.where, t, true)}
					</span>
				</span>
			) : null}
		</span>
	);
}

// ── Then and now ──────────────────────────────────────────────────────────

type CompareMode = "side" | "overlay";

function CompareView({ state }: { state: Extract<PhotoViewerState, { mode: "compare" }> }) {
	const { t } = useT();
	const dayLabel = usePhotoDay(true);
	const [mode, setMode] = useState<CompareMode>("side");
	const [split, setSplit] = useState(50);
	const { before, after } = state;
	const ratio = after.ref.w / after.ref.h;
	const days = before.day && after.day ? Math.max(0, diffDays(after.day, before.day)) : 0;
	const label = (which: "then" | "now", photo: ViewerPhoto) =>
		`${t(which === "then" ? "tracker.photo.then" : "tracker.photo.now")} · ${dayLabel(photo.day)}`;
	const altOf = (photo: ViewerPhoto) =>
		photoAlt(photo.ref, { date: photo.day, data: { caption: photo.caption } }, t);
	const modes: { value: CompareMode; label: string }[] = [
		{ value: "side", label: t("tracker.photo.sideBySide") },
		{ value: "overlay", label: t("tracker.photo.overlay") },
	];
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<TopBar>
				<p className="font-semibold text-body text-white">{t("tracker.photo.compare")}</p>
				{days > 0 ? (
					<p className="text-small text-white/70">{t.tp("tracker.photo.progressDays", days)}</p>
				) : null}
			</TopBar>
			<div className="flex shrink-0 justify-center px-4 pb-3">
				<fieldset className="inline-flex rounded-full bg-white/10 p-1">
					<legend className="sr-only">{t("tracker.photo.compareMode")}</legend>
					{modes.map((option) => (
						<label
							key={option.value}
							className={cn(
								"relative inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3.5 font-medium text-small transition-colors has-focus-visible:outline-2 has-focus-visible:outline-white",
								mode === option.value ? "bg-white text-black" : "text-white/80 hover:text-white",
							)}
						>
							<input
								type="radio"
								name="compare-mode"
								value={option.value}
								checked={mode === option.value}
								onChange={() => setMode(option.value)}
								className="sr-only"
							/>
							{option.value === "side" ? <Columns2 aria-hidden="true" className="size-4" /> : null}
							{option.label}
						</label>
					))}
				</fieldset>
			</div>
			{mode === "side" ? (
				// One row for both photos, one for both captions: a longer caption never shifts a photo.
				<div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-[minmax(0,1fr)_auto] gap-x-2 gap-y-2 px-2 pb-[max(16px,env(safe-area-inset-bottom))] md:gap-x-4 md:px-6">
					{(
						[
							["then", before],
							["now", after],
						] as const
					).map(([which, photo]) => (
						<figure key={which} className="row-span-2 grid min-h-0 grid-rows-subgrid">
							<div className="flex min-h-0 items-center justify-center">
								<FullPhoto photo={photo} alt={altOf(photo)} />
							</div>
							<figcaption className="text-center text-small text-white/85">
								<span className="font-semibold text-white">
									{t(which === "then" ? "tracker.photo.then" : "tracker.photo.now")}
								</span>{" "}
								· {dayLabel(photo.day)}
							</figcaption>
						</figure>
					))}
				</div>
			) : (
				<div className="flex min-h-0 flex-1 flex-col items-center gap-3 px-2 pb-[max(16px,env(safe-area-inset-bottom))] md:px-6">
					{/* The frame takes the latest photo's shape, as large as fits (size container units). */}
					<div
						className="grid min-h-0 w-full flex-1 place-items-center"
						style={{ containerType: "size" }}
					>
						<div
							className="relative overflow-hidden rounded-lg"
							style={{
								width: `min(100cqw, calc(100cqh * ${ratio}))`,
								height: `min(100cqh, calc(100cqw / ${ratio}))`,
							}}
						>
							<FullPhoto
								photo={before}
								alt={altOf(before)}
								fit="cover"
								className="absolute inset-0"
							/>
							<span
								className="absolute inset-0"
								style={{ clipPath: `inset(0 0 0 ${split}%)` }}
								aria-hidden="true"
							>
								<FullPhoto photo={after} alt="" fit="cover" />
							</span>
							<span
								aria-hidden="true"
								className="-translate-x-1/2 pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
								style={{ left: `${split}%` }}
							/>
							<span className="pointer-events-none absolute top-2 left-2 rounded-full bg-black/65 px-2.5 py-1 font-medium text-tiny text-white">
								{label("then", before)}
							</span>
							<span className="pointer-events-none absolute top-2 right-2 rounded-full bg-black/65 px-2.5 py-1 font-medium text-tiny text-white">
								{label("now", after)}
							</span>
						</div>
					</div>
					<input
						type="range"
						min={0}
						max={100}
						step={1}
						value={split}
						onChange={(event) => setSplit(Number(event.target.value))}
						aria-label={t("tracker.photo.reveal")}
						aria-valuetext={`${t("tracker.photo.then")} ${t.percent(split / 100)} · ${t("tracker.photo.now")} ${t.percent(1 - split / 100)}`}
						className="w-full max-w-md accent-white"
					/>
				</div>
			)}
		</div>
	);
}
