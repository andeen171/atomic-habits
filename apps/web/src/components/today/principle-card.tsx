import { useT } from "@/lib/messages";
import { usePrincipleHidden } from "@/lib/prefs";
import { useUI } from "@/lib/ui";
import { useIsMobile } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { type DayKey, type Principle, principleLawKey, principleOfTheDay } from "@atomic/core";
import { useLocale } from "@atomic/core/react";
import { ChevronDown, EyeOff, Quote } from "lucide-react";
import { type RefObject, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { IconButton } from "../ui/icon-button";

/**
 * The principle of the day, at the top of Today (item 8; spec §5.1, Annex H
 * §1.5). It follows the viewed day and can be hidden for that day, which
 * leaves a one-line strip that brings it back. Below `md` it is compact: law
 * chip and title, the body clamped to two lines (tap to read more).
 *
 * Only `text` and `text-muted` sit on the accent-soft surface: `text-subtle`
 * fails AA there.
 */
export function PrincipleHero({ day, className }: { day: DayKey; className?: string }) {
	const { t } = useT();
	const locale = useLocale();
	const compact = useIsMobile();
	const principle = principleOfTheDay(day, locale);
	const [hidden, setHidden] = usePrincipleHidden(day);
	const contentId = useId();
	const showRef = useRef<HTMLButtonElement>(null);
	const hideRef = useRef<HTMLButtonElement>(null);
	/** Where focus goes after the user toggles (the button they pressed disappears). */
	const pendingFocus = useRef<"show" | "hide" | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: runs after each hide/show render.
	useEffect(() => {
		const target = pendingFocus.current;
		pendingFocus.current = null;
		if (target === "show") showRef.current?.focus();
		else if (target === "hide") hideRef.current?.focus();
	}, [hidden]);

	const hide = () => {
		pendingFocus.current = "show";
		setHidden(true);
	};
	const show = () => {
		pendingFocus.current = "hide";
		setHidden(false);
	};

	return (
		<section aria-label={t("today.principle")} className={cn("mb-6 md:mb-8", className)}>
			{hidden ? (
				<button
					ref={showRef}
					type="button"
					aria-expanded={false}
					aria-controls={contentId}
					title={t("today.principleShow")}
					onClick={show}
					className="group flex min-h-11 w-full animate-fade-in items-center gap-3 rounded-xl border border-accent/20 bg-accent-soft/45 px-4 py-2 text-left transition-colors duration-(--atomic-duration-fast) hover:bg-accent-soft/70"
				>
					<Quote aria-hidden="true" className="size-4 shrink-0 text-accent-text" />
					<span className="min-w-0 flex-1 truncate text-small">
						<span className="text-ink-muted">{t("today.principle")}: </span>
						<span className="font-medium text-ink">{principle.title}</span>
					</span>
					<span className="sr-only">{t("today.principleShow")}</span>
					<ChevronDown
						aria-hidden="true"
						className="size-4 shrink-0 text-ink-muted transition-transform group-hover:translate-y-px"
					/>
				</button>
			) : null}
			<div id={contentId} hidden={hidden}>
				{compact ? (
					<CompactPrinciple
						principle={principle}
						contentId={contentId}
						hideRef={hideRef}
						onHide={hide}
					/>
				) : (
					<FullPrinciple
						principle={principle}
						contentId={contentId}
						hideRef={hideRef}
						onHide={hide}
					/>
				)}
			</div>
		</section>
	);
}

interface PrincipleViewProps {
	principle: Principle;
	/** The region the hide button collapses (`aria-controls`). */
	contentId: string;
	hideRef: RefObject<HTMLButtonElement | null>;
	onHide(): void;
}

/** md and up: the full hero (title in display serif, the whole body). */
function FullPrinciple({ principle, contentId, hideRef, onHide }: PrincipleViewProps) {
	const { t } = useT();
	return (
		<div className="relative animate-fade-in overflow-hidden rounded-2xl border border-accent/20 bg-gradient-to-br from-accent-soft/70 via-surface to-surface p-6 shadow-card">
			<span
				aria-hidden="true"
				className="pointer-events-none absolute top-1 right-16 select-none font-display text-[10rem] text-accent/12 leading-[0.8]"
			>
				“
			</span>
			<div className="relative flex items-center gap-2.5">
				<span className="font-semibold text-ink-muted text-tiny uppercase tracking-[0.08em]">
					{t("today.principle")}
				</span>
				<LawChip law={principle.law} />
				<IconButton
					ref={hideRef}
					label={t("today.principleHide")}
					aria-expanded={true}
					aria-controls={contentId}
					size="sm"
					className="-my-1 -mr-2 ml-auto text-ink-muted"
					onClick={onHide}
				>
					<EyeOff />
				</IconButton>
			</div>
			<h2 className="relative mt-3 max-w-3xl text-balance font-display text-[2.25rem] text-ink leading-[1.1]">
				{principle.title}
			</h2>
			<p className="relative mt-2.5 max-w-3xl text-[1.0625rem] text-ink-muted leading-relaxed">
				{principle.body}
			</p>
		</div>
	);
}

/**
 * Phones: law chip and title, the body clamped to two lines. Tapping the body
 * expands it; "Read more" is the keyboard and screen-reader control, shown
 * only when the text actually overflows.
 */
function CompactPrinciple({ principle, contentId, hideRef, onHide }: PrincipleViewProps) {
	const { t } = useT();
	const bodyId = useId();
	const bodyRef = useRef<HTMLParagraphElement>(null);
	const [expanded, setExpanded] = useState(false);
	const [overflows, setOverflows] = useState(false);

	// A new principle (another day viewed) starts clamped.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset when the principle changes.
	useEffect(() => setExpanded(false), [principle.id]);

	// Measured while clamped: fonts, width and text change whether it overflows.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes.
	useLayoutEffect(() => {
		const el = bodyRef.current;
		if (!el || expanded) return;
		const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [expanded, principle.body]);

	const toggle = () => setExpanded((value) => !value);
	const expandable = overflows || expanded;

	return (
		<div className="relative animate-fade-in overflow-hidden rounded-xl border border-accent/20 bg-accent-soft/60 p-4">
			<div className="flex items-center gap-2">
				<Quote aria-hidden="true" className="size-4 shrink-0 text-accent-text" />
				{principleLawKey(principle.law) ? (
					<LawChip law={principle.law} />
				) : (
					<span className="font-semibold text-ink-muted text-tiny uppercase tracking-[0.08em]">
						{t("today.principle")}
					</span>
				)}
				<IconButton
					ref={hideRef}
					label={t("today.principleHide")}
					aria-expanded={true}
					aria-controls={contentId}
					className="-my-1.5 -mr-1.5 ml-auto text-ink-muted"
					onClick={onHide}
				>
					<EyeOff />
				</IconButton>
			</div>
			<h2 className="mt-1.5 text-balance font-display text-[1.5rem] text-ink leading-[1.15]">
				{principle.title}
			</h2>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: "Read more" below is the keyboard control. */}
			<p
				ref={bodyRef}
				id={bodyId}
				onClick={expandable ? toggle : undefined}
				className={cn(
					"mt-1 text-ink-muted text-small leading-relaxed",
					!expanded && "line-clamp-2",
					expandable && "cursor-pointer",
				)}
			>
				{principle.body}
			</p>
			{expandable ? (
				<button
					type="button"
					aria-expanded={expanded}
					aria-controls={bodyId}
					onClick={toggle}
					className="-mx-1 mt-1 inline-flex min-h-8 items-center rounded-xs px-1 font-medium text-ink text-small underline decoration-ink/30 underline-offset-3 hover:decoration-ink"
				>
					{expanded ? t("today.principleLess") : t("today.principleMore")}
				</button>
			) : null}
		</div>
	);
}

/** Laws 1–4 use the law's name, law 5 "Breaking"; it opens the four-laws explainer. */
export function LawChip({ law }: { law: Principle["law"] }) {
	const { t, at } = useT();
	const openFourLaws = useUI((s) => s.setFourLawsOpen);
	const key = principleLawKey(law);
	if (!key) return null;
	const name = t(key);
	return (
		<button
			type="button"
			aria-label={`${name} · ${at("settings.fourLaws")}`}
			onClick={() => openFourLaws(true)}
			className="inline-flex h-6 min-w-0 items-center truncate rounded-full border border-accent/25 bg-surface/80 px-2.5 font-medium text-ink text-tiny transition-colors hover:border-accent/50 hover:bg-surface"
		>
			{name}
		</button>
	);
}
