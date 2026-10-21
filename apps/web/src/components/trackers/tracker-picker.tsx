import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import {
	type Habit,
	type HabitKind,
	type Locale,
	type TrackerConfig,
	type TrackerConfigInput,
	type TrackerDef,
	type TrackerType,
	type Translator,
	defaultTrackerConfig,
	knownTracker,
	trackerHint,
	trackerMeta,
	trackerName,
	trackerUnitWord,
	trackersForKind,
} from "@atomic/core";
import { useHabit } from "@atomic/core/react";
import { useParams } from "@tanstack/react-router";
import { Check, Info } from "lucide-react";
import { useId, useRef } from "react";
import type { HabitDraft } from "../editor/draft";
import type { DraftUpdate } from "../editor/editor-fields";
import { deviceRegion, trackerCaps } from "./caps";
import { TrackerSettingsFields } from "./tracker-settings";

export interface TrackerFieldProps {
	draft: HabitDraft;
	update: DraftUpdate;
}

/** A draft's tracker parsed with defaults, when it is known and switched on. */
export function draftTracker(tracker: TrackerConfigInput | null): TrackerConfig | null {
	if (!tracker || tracker.enabled === false) return null;
	return knownTracker({ tracker } as Pick<Habit, "tracker">);
}

/** A new config of a type, prefilled from the habit (wake time from the cue, currency from the device). */
export function newTrackerConfig(
	type: TrackerType,
	locale: Locale,
	habit: { cueTime: string | null; target: number },
): TrackerConfig {
	return defaultTrackerConfig(type, { locale, region: deviceRegion(), habit });
}

/**
 * The goal that goes with a tracker (Annex K §1.5): days and threshold
 * measures are done once (target 1, no unit); sum measures suggest the
 * tracker's default target unless the habit already counts in that unit.
 */
export function goalFor(
	config: TrackerConfig,
	current: { target: number; unit: string | null },
	t: Translator,
): { target: number; unit: string | null } {
	const meta = trackerMeta(config);
	const measure = meta.measure(config);
	const unit = trackerUnitWord(meta.unit(config), config, t);
	if (measure === "days" || measure === "threshold") return { target: 1, unit: null };
	const sameUnit =
		!!unit && !!current.unit && current.unit.trim().toLowerCase() === unit.toLowerCase();
	return {
		target: sameUnit && current.target > 1 ? current.target : meta.defaultTarget(config),
		unit,
	};
}

/**
 * "How will you log it?" on the editor's Easy step (Annex K §4.1, spec
 * §5.4): radio cards for "Simple check-off" and the trackers for the habit's
 * kind (break habits see only the slip journal), with the chosen tracker's
 * settings inline. Choosing one sets the goal it needs. Hidden until a
 * tracker milestone is released. Owner: T4.
 */
export function TrackerField({ draft, update }: TrackerFieldProps) {
	const { t } = useT();
	const caps = trackerCaps();
	const options = trackersForKind(draft.kind, caps);
	// Edit mode: the stored habit decides "back to simple" (detach) and the "starts today" hint.
	const params = useParams({ strict: false }) as { habitId?: string };
	const stored = useHabit(params.habitId);
	const storedConfig = stored ? knownTracker(stored) : null;
	const storedActive = !!storedConfig && storedConfig.enabled !== false;
	// "Simple check-off" gives back the plain goal from before a tracker was picked here, else
	// the goal the editor opened with (a stored tracker's own; the store then applies its detach rule).
	const plainGoal = useRef<{ target: number; unit: string } | null>(null);
	const openedGoal = useRef({ target: draft.target, unit: draft.unit });
	if (!options.length) return null;

	const config = draftTracker(draft.tracker);
	const selected: TrackerType | "simple" = config?.type ?? "simple";
	const current = { target: draft.target, unit: draft.unit.trim() || null };

	const choose = (type: TrackerType | "simple") => {
		if (type === "simple") {
			// A stored tracker is switched off (kept for later); a new one is simply dropped.
			const base = draft.tracker ?? storedConfig;
			update({
				tracker: stored && base ? ({ ...base, enabled: false } as TrackerConfigInput) : null,
				...(plainGoal.current ?? openedGoal.current),
			});
			plainGoal.current = null;
			return;
		}
		if (selected === "simple") plainGoal.current = { target: draft.target, unit: draft.unit };
		const next =
			draft.tracker?.type === type
				? (draftTracker({ ...draft.tracker, enabled: true } as TrackerConfigInput) as TrackerConfig)
				: storedConfig?.type === type
					? ({ ...storedConfig, enabled: true } as TrackerConfig)
					: newTrackerConfig(type, t.locale, {
							cueTime: draft.cueTime || null,
							target: draft.target,
						});
		const goal = goalFor(next, current, t);
		update({ tracker: next, target: goal.target, unit: goal.unit ?? "" });
	};

	const change = (next: TrackerConfig) => {
		const before = config ? trackerMeta(config).measure(config) : null;
		const after = trackerMeta(next).measure(next);
		const unitChanged = config && trackerMeta(config).unit(config) !== trackerMeta(next).unit(next);
		if (before !== after || unitChanged) {
			const goal = goalFor(next, current, t);
			update({ tracker: next, target: goal.target, unit: goal.unit ?? "" });
		} else update({ tracker: next });
	};

	const hint =
		stored && config
			? storedActive && storedConfig?.type !== config.type
				? t("tracker.settings.switchHint")
				: !storedActive
					? t("tracker.startsToday")
					: null
			: null;

	return (
		<section className="flex flex-col gap-3">
			<div>
				<h3 className="font-medium text-ink text-small">{t("tracker.field")}</h3>
				<p className="text-ink-subtle text-small">{t("tracker.fieldHint")}</p>
			</div>
			<TrackerOptionCards
				kind={draft.kind}
				options={options}
				value={selected}
				onChange={choose}
				label={t("tracker.field")}
			/>
			{config ? (
				<div className="flex flex-col gap-4 rounded-xl border border-line bg-sunken/40 p-4">
					{hint ? (
						<p className="flex items-start gap-2 text-ink-muted text-small">
							<Info className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
							{hint}
						</p>
					) : null}
					<TrackerSettingsFields config={config} onChange={change} />
				</div>
			) : null}
		</section>
	);
}

/**
 * Radio cards: "Simple check-off" (optional) and the trackers, each with its
 * icon, name and one-line hint. Native radios, so arrow keys and screen
 * readers work as for any radio group.
 */
export function TrackerOptionCards({
	kind,
	options,
	value,
	onChange,
	label,
	simple = true,
	className,
}: {
	kind: HabitKind;
	options: readonly TrackerDef[];
	value: TrackerType | "simple";
	onChange(value: TrackerType | "simple"): void;
	label: string;
	simple?: boolean;
	className?: string;
}) {
	const { t } = useT();
	const name = useId();
	const items: { value: TrackerType | "simple"; emoji: string; title: string; hint: string }[] = [
		...(simple
			? [
					{
						value: "simple" as const,
						emoji: kind === "break" ? "🛡️" : "✅",
						title: t("tracker.simple"),
						hint: t("tracker.simpleHint"),
					},
				]
			: []),
		...options.map((def) => ({
			value: def.type,
			emoji: def.emoji,
			title: trackerName(def.type, t),
			hint: trackerHint(def.type, t),
		})),
	];
	return (
		<div
			role="radiogroup"
			aria-label={label}
			className={cn("grid grid-cols-1 gap-2 sm:grid-cols-2", className)}
		>
			{items.map((item) => {
				const checked = item.value === value;
				return (
					<label
						key={item.value}
						className={cn(
							"relative flex cursor-pointer items-start gap-3 rounded-lg border bg-surface p-3 transition-[border-color,box-shadow,background-color] duration-(--atomic-duration-fast)",
							"has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-ring has-[input:focus-visible]:outline-offset-2",
							checked
								? "border-accent shadow-[0_0_0_1px_var(--accent)]"
								: "border-line hover:border-line-strong hover:bg-hover/50",
						)}
					>
						<input
							type="radio"
							name={name}
							value={item.value}
							checked={checked}
							onChange={() => onChange(item.value)}
							className="sr-only"
						/>
						<span
							aria-hidden="true"
							className="grid size-9 shrink-0 place-items-center rounded-full bg-sunken font-emoji text-lg"
						>
							{item.emoji}
						</span>
						<span className="min-w-0 flex-1">
							<span className="block break-words font-medium text-ink text-small">
								{item.title}
							</span>
							<span className="block break-words text-ink-muted text-small">{item.hint}</span>
						</span>
						{checked ? (
							<Check aria-hidden="true" className="size-4 shrink-0 text-accent-text" />
						) : null}
					</label>
				);
			})}
		</div>
	);
}
