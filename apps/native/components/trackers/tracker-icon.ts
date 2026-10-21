import {
	BookOpen,
	Camera,
	Dumbbell,
	Hash,
	HeartHandshake,
	ListChecks,
	type LucideIcon,
	Moon,
	PenLine,
	Receipt,
	ShieldAlert,
	Sunrise,
	Timer,
} from "@/components/icons";
import type { TrackerType } from "@atomic/core";

/** The icon of a tracker's main action ("Add expense", "Start timer"…). Owner: T4. */
export const TRACKER_ICONS: Record<TrackerType, LucideIcon> = {
	expense: Receipt,
	reading: BookOpen,
	workout: Dumbbell,
	session: Timer,
	writing: PenLine,
	wake: Sunrise,
	sleep: Moon,
	plan: ListChecks,
	connection: HeartHandshake,
	slip: ShieldAlert,
	photo: Camera,
	measure: Hash,
};
