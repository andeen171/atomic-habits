import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { type Habit, blueprintLines, scheduleLabel } from "@atomic/core";
import { useAtomic } from "@atomic/core/react";
import { HabitRingGraphic } from "../habit/habit-ring";

interface HabitPreviewProps {
	habit: Habit;
	identityStatement: string | null;
	compact?: boolean;
	className?: string;
}

/** Live preview: ring, name, schedule and the first blueprint sentence. */
export function HabitPreview({ habit, identityStatement, compact, className }: HabitPreviewProps) {
	const { t, at } = useT();
	const style = useHabitStyle(habit.color);
	const weekStartsOn = useAtomic((s) => s.settings.weekStartsOn);
	const lines = blueprintLines(habit, t);
	const schedule =
		habit.kind === "break"
			? t("habits.filter.break")
			: `${scheduleLabel(habit, t, weekStartsOn)} · ${t(`time.${habit.timeOfDay}`)}`;

	return (
		<div
			style={style}
			className={cn(
				"overflow-hidden rounded-xl border border-line bg-surface shadow-card",
				className,
			)}
		>
			{compact ? null : (
				<div className="border-line border-b px-5 py-3">
					<span className="section-label">{at("form.preview")}</span>
				</div>
			)}
			<div className={cn("flex items-center gap-3.5", compact ? "p-3.5" : "px-5 pt-5")}>
				<HabitRingGraphic
					habit={habit}
					progress={habit.kind === "break" ? 1 : 0.35}
					state="pending"
					size={compact ? 40 : 48}
				/>
				<div className="min-w-0 flex-1">
					<p className="line-clamp-2 break-words font-semibold text-ink leading-snug">
						{habit.name}
					</p>
					<p className="line-clamp-2 break-words text-ink-muted text-small">
						{habit.twoMinute && compact ? (
							<span className="italic">{habit.twoMinute}</span>
						) : (
							schedule
						)}
					</p>
				</div>
			</div>
			{compact ? null : (
				<div className="px-5 pt-4 pb-5">
					{lines.length ? (
						<ul className="flex flex-col gap-2">
							{lines.slice(0, 4).map((line) => (
								<li key={line.text} className="flex gap-2 text-ink-muted text-small">
									<span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-(--habit)" />
									{line.text}
								</li>
							))}
						</ul>
					) : (
						<p className="text-ink-subtle text-small">{t("detail.blueprintEmpty")}</p>
					)}
					{identityStatement ? (
						<div className="mt-4 border-line border-t pt-3">
							<p className="section-label">{t("detail.identity")}</p>
							<p className="mt-0.5 font-display text-[1.25rem] text-ink italic leading-snug">
								{identityStatement}
							</p>
						</div>
					) : null}
				</div>
			)}
		</div>
	);
}
