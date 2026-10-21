import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import { useHabitLogger, useResetDay } from "@/lib/use-habit-logger";
import {
	type DayKey,
	type Habit,
	canExceedTarget,
	getLog,
	isTrackerDay,
	targetOn,
} from "@atomic/core";
import { useActions, useAtomic, useToday } from "@atomic/core/react";
import { useNavigate } from "@tanstack/react-router";
import {
	Ellipsis,
	Eye,
	Hash,
	Minus,
	Pencil,
	Plus,
	RotateCcw,
	ShieldAlert,
	SkipForward,
	StickyNote,
	Undo2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { TrackerMenuItems } from "../trackers/tracker-menu-items";
import { IconButton } from "../ui/icon-button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../ui/menu";
import { LogAmountDialog } from "./log-amount-dialog";

interface HabitActionsMenuProps {
	habit: Habit;
	day: DayKey;
	open?: boolean;
	onOpenChange?(open: boolean): void;
	trigger?: ReactNode;
	triggerClassName?: string;
}

/**
 * Row actions: ±1, skip / reset, slip, note, edit, details. Skipping clears a
 * day's count, so it's only offered on a day with no progress; a day with
 * progress offers "Reset day" in its place. On a tracker day the count is
 * written by entries: the tracker's items replace ±1, skip, reset and slip
 * (Annex K §1.3).
 *
 * Above the target, reps are explicit (D11): count habits relabel "Add one"
 * as "Log an extra rep", binary habits that are done gain it, and build
 * habits offer "Log amount…". All three need `canExceedTarget`.
 */
export function HabitActionsMenu({
	habit,
	day,
	open,
	onOpenChange,
	trigger,
	triggerClassName,
}: HabitActionsMenuProps) {
	const { t, at } = useT();
	const actions = useActions();
	const navigate = useNavigate();
	const openNote = useUI((s) => s.openNoteDialog);
	const { tap, extraRep } = useHabitLogger();
	const today = useToday();
	const log = useAtomic((s) => getLog(s, habit.id, day));
	const count = log?.count ?? 0;
	const isBreak = habit.kind === "break";
	const resetDay = useResetDay();
	const trackerDay = isTrackerDay(habit, day);
	const [amountOpen, setAmountOpen] = useState(false);
	const target = targetOn(habit, day);
	const exceed = !isBreak && !trackerDay && canExceedTarget(habit);
	const counted = !isBreak && !trackerDay && target > 1;
	const extraForCount = counted && exceed && count >= target;
	const extraForBinary = !isBreak && !trackerDay && target === 1 && exceed && count >= 1;

	return (
		<>
			<Menu open={open} onOpenChange={onOpenChange} modal={false}>
				<MenuTrigger asChild>
					{trigger ?? (
						<IconButton
							label={at("common.moreFor", { name: habit.name })}
							size="sm"
							tooltip={false}
							className={triggerClassName}
						>
							<Ellipsis />
						</IconButton>
					)}
				</MenuTrigger>
				<MenuContent onClick={(event) => event.stopPropagation()}>
					{trackerDay ? <TrackerMenuItems habit={habit} day={day} /> : null}
					{counted ? (
						<>
							<MenuItem
								icon={<Plus />}
								onSelect={() =>
									extraForCount ? extraRep(habit, day) : actions.increment(habit.id, day, 1)
								}
							>
								{extraForCount ? t("month.extraRep") : t("habit.increment")}
							</MenuItem>
							<MenuItem
								icon={<Minus />}
								disabled={count === 0}
								onSelect={() => actions.increment(habit.id, day, -1)}
							>
								{t("habit.decrement")}
							</MenuItem>
						</>
					) : null}
					{extraForBinary ? (
						<MenuItem icon={<Plus />} onSelect={() => extraRep(habit, day)}>
							{t("month.extraRep")}
						</MenuItem>
					) : null}
					{exceed ? (
						<MenuItem icon={<Hash />} onSelect={() => setAmountOpen(true)}>
							{t("habit.logAmount")}
						</MenuItem>
					) : null}
					{counted || extraForBinary || exceed ? <MenuSeparator /> : null}
					{trackerDay ? null : isBreak ? (
						<MenuItem
							icon={count > 0 ? <Undo2 /> : <ShieldAlert />}
							onSelect={() => tap(habit, day, { manual: true })}
						>
							{count > 0 ? t("habit.undoSlip") : t("habit.logSlip")}
						</MenuItem>
					) : log?.skipped ? (
						<MenuItem icon={<Undo2 />} onSelect={() => actions.setSkipped(habit.id, day, false)}>
							{t("habit.unskip")}
						</MenuItem>
					) : count === 0 ? (
						<MenuItem
							icon={<SkipForward />}
							onSelect={() => actions.setSkipped(habit.id, day, true)}
						>
							{day === today ? t("habit.skip") : t("habit.skipDay")}
						</MenuItem>
					) : (
						<MenuItem icon={<RotateCcw />} onSelect={() => resetDay(habit, day)}>
							{t("habit.reset")}
						</MenuItem>
					)}
					<MenuItem
						icon={<StickyNote />}
						onSelect={() => openNote({ habitId: habit.id, date: day })}
					>
						{log?.note ? t("habit.editNote") : t("habit.addNote")}
					</MenuItem>
					<MenuSeparator />
					<MenuItem
						icon={<Pencil />}
						onSelect={() =>
							navigate({ to: "/habits/$habitId/edit", params: { habitId: habit.id } })
						}
					>
						{t("common.edit")}
					</MenuItem>
					<MenuItem
						icon={<Eye />}
						onSelect={() => navigate({ to: "/habits/$habitId", params: { habitId: habit.id } })}
					>
						{t("habit.viewDetails")}
					</MenuItem>
				</MenuContent>
			</Menu>
			{exceed ? (
				<LogAmountDialog habit={habit} day={day} open={amountOpen} onOpenChange={setAmountOpen} />
			) : null}
		</>
	);
}
