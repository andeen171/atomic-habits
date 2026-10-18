import type { DayState, Habit } from "@atomic/core";
import { motion as tokens } from "@atomic/core/theme";
import { AnimatePresence, motion } from "motion/react";
import type { ComponentProps } from "react";
import { useHabitStyle } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface HabitRingProps {
	habit: Habit;
	/** 0–1 toward today's target. */
	progress: number;
	state: DayState;
	size?: number;
	/** Hide the emoji (e.g. tiny rings in lists). */
	showEmoji?: boolean;
	className?: string;
}

const spring = { type: "spring", ...tokens.spring } as const;

/**
 * Circular progress in the habit's hue over a soft track, emoji centered.
 * Done → filled disc with a check; skipped → dashed track; break habits use a
 * shield style (clean = soft fill, slipped = danger outline).
 */
export function HabitRingGraphic({
	habit,
	progress,
	state,
	size = 44,
	showEmoji = true,
	className,
}: HabitRingProps) {
	const style = useHabitStyle(habit.color);
	const stroke = Math.max(2.5, size * 0.07);
	const r = size / 2 - stroke / 2 - 0.5;
	const c = 2 * Math.PI * r;
	const isBreak = habit.kind === "break";
	const done = !isBreak && state === "done";
	const slipped = isBreak && state === "slipped";
	const dashed = state === "skipped" || state === "rest" || state === "inactive";
	const emojiSize = Math.round(size * 0.44);

	return (
		<span
			className={cn("relative inline-grid shrink-0 place-items-center", className)}
			style={{ ...style, width: size, height: size }}
		>
			<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="absolute inset-0">
				{isBreak ? (
					<circle
						cx={size / 2}
						cy={size / 2}
						r={r}
						fill={slipped ? "var(--danger-soft)" : "var(--habit-soft)"}
						stroke={slipped ? "var(--danger)" : "var(--habit-soft)"}
						strokeWidth={stroke}
					/>
				) : (
					<>
						<circle
							cx={size / 2}
							cy={size / 2}
							r={r}
							fill="none"
							stroke={dashed ? "var(--border-strong)" : "var(--habit-soft)"}
							strokeWidth={dashed ? Math.max(1.5, stroke * 0.6) : stroke}
							strokeDasharray={dashed ? `${stroke * 1.1} ${stroke * 1.4}` : undefined}
						/>
						<motion.circle
							cx={size / 2}
							cy={size / 2}
							r={r}
							fill="none"
							stroke="var(--habit)"
							strokeWidth={stroke}
							strokeLinecap="round"
							strokeDasharray={c}
							initial={false}
							animate={{ strokeDashoffset: c * (1 - Math.min(1, Math.max(0, progress))) }}
							transition={spring}
							transform={`rotate(-90 ${size / 2} ${size / 2})`}
						/>
					</>
				)}
			</svg>
			<AnimatePresence initial={false} mode="popLayout">
				{done ? (
					<motion.span
						key="done"
						className="absolute inset-0 grid place-items-center rounded-full bg-(--habit)"
						initial={{ scale: 0.55, opacity: 0 }}
						animate={{ scale: 1, opacity: 1 }}
						exit={{ scale: 0.7, opacity: 0 }}
						transition={spring}
					>
						<svg viewBox="0 0 24 24" fill="none" aria-hidden style={{ width: size * 0.46, height: size * 0.46 }}>
							<motion.path
								d="M5 12.5l4.5 4.5L19 7.5"
								stroke="white"
								strokeWidth={2.75}
								strokeLinecap="round"
								strokeLinejoin="round"
								initial={{ pathLength: 0 }}
								animate={{ pathLength: 1 }}
								transition={{ duration: tokens.base / 1000, delay: 0.06, ease: "easeOut" }}
							/>
						</svg>
					</motion.span>
				) : showEmoji ? (
					<motion.span
						key="emoji"
						className={cn(
							"relative select-none font-emoji leading-none",
							(state === "skipped" || state === "missed" || state === "inactive") && "opacity-50 grayscale-[40%]",
						)}
						style={{ fontSize: emojiSize }}
						initial={{ scale: 0.6, opacity: 0 }}
						animate={{ scale: 1, opacity: 1 }}
						exit={{ scale: 0.6, opacity: 0 }}
						transition={spring}
					>
						{habit.emoji}
					</motion.span>
				) : null}
			</AnimatePresence>
		</span>
	);
}

interface HabitRingButtonProps extends HabitRingProps, Omit<ComponentProps<typeof motion.button>, "children"> {
	label: string;
	/** Target 1 build habits behave like a checkbox. */
	checkbox?: boolean;
	checked?: boolean;
	shake?: boolean;
}

export function HabitRingButton({
	habit,
	progress,
	state,
	size = 44,
	showEmoji,
	label,
	checkbox,
	checked,
	shake,
	className,
	...props
}: HabitRingButtonProps) {
	return (
		<motion.button
			type="button"
			role={checkbox ? "checkbox" : undefined}
			aria-checked={checkbox ? checked : undefined}
			aria-label={label}
			whileTap={{ scale: 0.88 }}
			transition={spring}
			className={cn(
				"relative grid shrink-0 place-items-center rounded-full outline-offset-3 disabled:cursor-not-allowed disabled:opacity-60",
				shake && "animate-shake",
				className,
			)}
			{...props}
		>
			<HabitRingGraphic habit={habit} progress={progress} state={state} size={size} showEmoji={showEmoji} />
		</motion.button>
	);
}
