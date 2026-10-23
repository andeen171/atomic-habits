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
} from "@/components/icons";
import { useTheme } from "@/lib/theme";
import { type HabitColor, type JournalKindSpec, journalKindSpec } from "@atomic/core";
import { type StyleProp, View, type ViewStyle } from "react-native";

/** The lucide icon of each kind's `icon` key (Annex J §5; same set as web). */
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
	/** Inline in a card's title row. */
	xs: { box: 26, radius: 8, icon: 14 },
	sm: { box: 32, radius: 9, icon: 16 },
	md: { box: 40, radius: 12, icon: 20 },
	lg: { box: 48, radius: 14, icon: 24 },
} as const;

export interface JournalKindIconProps {
	/** A journal kind; unknown kinds (from newer builds) show the note icon. */
	kind: string;
	/** Overrides the kind's accent (evidence takes its identity's color). */
	color?: HabitColor;
	size?: keyof typeof SIZES;
	/** Dimmed tile for kinds that can't be picked yet. */
	muted?: boolean;
	style?: StyleProp<ViewStyle>;
}

/**
 * A kind's icon on a tile tinted with its accent (habit color tokens, so it
 * follows light and dark mode). Decorative: the kind's name is always shown
 * or spoken next to it.
 */
export function JournalKindIcon({ kind, color, size = "md", muted, style }: JournalKindIconProps) {
	const { colors, habit: toneOf } = useTheme();
	const spec = journalKindSpec(kind);
	const Icon = JOURNAL_KIND_ICONS[spec.icon];
	const tone = toneOf(color ?? spec.color);
	const box = SIZES[size];
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={[
				{
					width: box.box,
					height: box.box,
					borderRadius: box.radius,
					alignItems: "center",
					justifyContent: "center",
					backgroundColor: muted ? colors.sunken : tone.soft,
				},
				style,
			]}
		>
			<Icon size={box.icon} color={muted ? colors.textSubtle : tone.text} strokeWidth={1.9} />
		</View>
	);
}
