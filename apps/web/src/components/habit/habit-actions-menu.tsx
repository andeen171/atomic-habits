import { type DayKey, type Habit, getLog } from "@atomic/core";
import { useActions, useAtomic } from "@atomic/core/react";
import { useNavigate } from "@tanstack/react-router";
import {
	Ellipsis,
	Eye,
	Minus,
	Pencil,
	Plus,
	RotateCcw,
	ShieldAlert,
	SkipForward,
	StickyNote,
	Undo2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import { IconButton } from "../ui/icon-button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../ui/menu";

interface HabitActionsMenuProps {
	habit: Habit;
	day: DayKey;
	open?: boolean;
	onOpenChange?(open: boolean): void;
	trigger?: ReactNode;
	triggerClassName?: string;
}

/** Row actions: ±1, skip, slip, note, edit, details, reset day. */
export function HabitActionsMenu({
	habit,
	day,
	open,
	onOpenChange,
	trigger,
	triggerClassName,
}: HabitActionsMenuProps) {
	const { t } = useT();
	const actions = useActions();
	const navigate = useNavigate();
	const openNote = useUI((s) => s.openNoteDialog);
	const log = useAtomic((s) => getLog(s, habit.id, day));
	const count = log?.count ?? 0;
	const isBreak = habit.kind === "break";

	return (
		<Menu open={open} onOpenChange={onOpenChange} modal={false}>
			<MenuTrigger asChild>
				{trigger ?? (
					<IconButton label={t("common.more")} size="sm" tooltip={false} className={triggerClassName}>
						<Ellipsis />
					</IconButton>
				)}
			</MenuTrigger>
			<MenuContent onClick={(event) => event.stopPropagation()}>
				{!isBreak && habit.target > 1 ? (
					<>
						<MenuItem icon={<Plus />} onSelect={() => actions.increment(habit.id, day, 1)}>
							{t("habit.increment")}
						</MenuItem>
						<MenuItem icon={<Minus />} disabled={count === 0} onSelect={() => actions.increment(habit.id, day, -1)}>
							{t("habit.decrement")}
						</MenuItem>
						<MenuSeparator />
					</>
				) : null}
				{isBreak ? (
					<MenuItem
						icon={count > 0 ? <Undo2 /> : <ShieldAlert />}
						onSelect={() => actions.setCount(habit.id, day, count > 0 ? 0 : 1)}
					>
						{count > 0 ? t("habit.undoSlip") : t("habit.logSlip")}
					</MenuItem>
				) : (
					<MenuItem
						icon={log?.skipped ? <Undo2 /> : <SkipForward />}
						onSelect={() => actions.setSkipped(habit.id, day, !log?.skipped)}
					>
						{log?.skipped ? t("habit.unskip") : t("habit.skip")}
					</MenuItem>
				)}
				<MenuItem icon={<StickyNote />} onSelect={() => openNote({ habitId: habit.id, date: day })}>
					{log?.note ? t("habit.editNote") : t("habit.addNote")}
				</MenuItem>
				<MenuSeparator />
				<MenuItem
					icon={<Pencil />}
					onSelect={() => navigate({ to: "/habits/$habitId/edit", params: { habitId: habit.id } })}
				>
					{t("common.edit")}
				</MenuItem>
				<MenuItem
					icon={<Eye />}
					onSelect={() => navigate({ to: "/habits/$habitId", params: { habitId: habit.id } })}
				>
					{t("habit.viewDetails")}
				</MenuItem>
				{count > 0 || log?.skipped ? (
					<MenuItem
						icon={<RotateCcw />}
						onSelect={() => {
							actions.setCount(habit.id, day, 0);
							if (log?.skipped) actions.setSkipped(habit.id, day, false);
						}}
					>
						{t("habit.reset")}
					</MenuItem>
				) : null}
			</MenuContent>
		</Menu>
	);
}
