import { useHabitStyle } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { type HabitColor, type JournalKindSpec, journalKindSpec } from "@atomic/core";
import {
	CalendarCheck,
	Compass,
	Eye,
	Gauge,
	Handshake,
	type LucideIcon,
	RefreshCw,
	Sparkles,
	StickyNote,
	Vote,
} from "lucide-react";

/** The lucide icon of each kind's `icon` key (Annex J §4). */
export const JOURNAL_KIND_ICONS: Readonly<Record<JournalKindSpec["icon"], LucideIcon>> = {
	vote: Vote,
	eye: Eye,
	refresh: RefreshCw,
	gauge: Gauge,
	handshake: Handshake,
	sparkles: Sparkles,
	"calendar-check": CalendarCheck,
	compass: Compass,
	"sticky-note": StickyNote,
};

const SIZES = {
	sm: "size-8 rounded-md [&_svg]:size-4",
	md: "size-10 rounded-lg [&_svg]:size-5",
	lg: "size-12 rounded-lg [&_svg]:size-6",
} as const;

interface JournalKindIconProps {
	/** A journal kind; unknown kinds (from newer builds) show the note icon. */
	kind: string;
	/** Overrides the kind's accent (evidence takes its identity's color). */
	color?: HabitColor;
	size?: keyof typeof SIZES;
	/** Dimmed tile for unavailable kinds in the picker. */
	muted?: boolean;
	className?: string;
}

/**
 * A kind's icon on a tile tinted with its accent (habit color tokens, so it
 * follows light and dark mode). Decorative: the kind's name is always shown
 * or announced next to it.
 */
export function JournalKindIcon({
	kind,
	color,
	size = "md",
	muted,
	className,
}: JournalKindIconProps) {
	const spec = journalKindSpec(kind);
	const Icon = JOURNAL_KIND_ICONS[spec.icon];
	const style = useHabitStyle(color ?? spec.color);
	return (
		<span
			aria-hidden="true"
			style={style}
			className={cn(
				"grid shrink-0 place-items-center",
				muted ? "bg-sunken text-ink-subtle" : "bg-(--habit-soft) text-(--habit-text)",
				SIZES[size],
				className,
			)}
		>
			<Icon strokeWidth={1.9} />
		</span>
	);
}
