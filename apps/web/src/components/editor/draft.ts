import {
	DEFAULT_HABIT_EMOJI,
	type DayKey,
	type Habit,
	type HabitColor,
	type HabitInput,
	type HabitKind,
	type HabitTemplate,
	type Identity,
	type IdentityTemplate,
	type Schedule,
	type SetupTaskDraft,
	type TimeOfDay,
	type TrackerConfigInput,
	type Weekday,
	autoHabitEmoji,
	identityTemplates,
	knownTracker,
	matchIdentityTemplate,
	pruneSetupDrafts,
} from "@atomic/core";

/** Editable form state for a habit (strings for text fields, never null). */
export interface HabitDraft {
	kind: HabitKind;
	name: string;
	/**
	 * The icon. In the editor it is always the resolved one (`withDraftLook`):
	 * while `emojiAuto`, the identity's emoji or the kind default.
	 */
	emoji: string;
	/** Resolved like `emoji`: while `colorAuto`, the identity's color (else the template's, else the kind's). */
	color: HabitColor;
	/** The icon follows the identity (or the kind default) until the user picks one (D12). */
	emojiAuto: boolean;
	/** The color follows the identity until the user picks one. Draft only: never stored. */
	colorAuto: boolean;
	identityId: string | null;
	/** Inline "new identity" statement, created on save when non-empty. */
	newIdentity: string | null;
	/** The new identity's emoji and color (a suggestion chip or the picker); null: matched or default. */
	newIdentityEmoji: string | null;
	newIdentityColor: HabitColor | null;
	/**
	 * The template last applied. Its emoji is offered as a one-tap "Use 📖"
	 * chip and never replaces an auto icon on its own (D12).
	 */
	template: { key: string; emoji: string; color: HabitColor } | null;
	scheduleType: Schedule["type"];
	days: Weekday[];
	times: number;
	timeOfDay: TimeOfDay;
	cueTime: string;
	cueLocation: string;
	stackAfter: string;
	twoMinute: string;
	target: number;
	unit: string;
	bundle: string;
	reward: string;
	environment: string;
	why: string;
	/** Setup tasks created with the habit on save (Annex T §4.4; T2's editor pieces write it). */
	setupTasks: SetupTaskDraft[];
	/** How the habit is logged (Annex K §4.3; `TrackerField` [T4] writes it); null: simple check-off. */
	tracker: TrackerConfigInput | null;
}

/** A habit's color when nothing else gives one. */
export const KIND_COLOR: Record<HabitKind, HabitColor> = { build: "ember", break: "rose" };

export function emptyDraft(kind: HabitKind = "build"): HabitDraft {
	return {
		kind,
		name: "",
		emoji: DEFAULT_HABIT_EMOJI[kind],
		color: KIND_COLOR[kind],
		emojiAuto: true,
		colorAuto: true,
		identityId: null,
		newIdentity: null,
		newIdentityEmoji: null,
		newIdentityColor: null,
		template: null,
		scheduleType: "daily",
		days: [1, 2, 3, 4, 5],
		times: 3,
		timeOfDay: "anytime",
		cueTime: "",
		cueLocation: "",
		stackAfter: "",
		twoMinute: "",
		target: 1,
		unit: "",
		bundle: "",
		reward: "",
		environment: "",
		why: "",
		setupTasks: [],
		tracker: null,
	};
}

const text = (value: string | null | undefined) => value ?? "";

function scheduleFields(schedule: Schedule): Pick<HabitDraft, "scheduleType" | "days" | "times"> {
	return {
		scheduleType: schedule.type,
		days: schedule.type === "weekdays" ? schedule.days.map((d) => d as Weekday) : [1, 2, 3, 4, 5],
		times: schedule.type === "weekly" ? schedule.times : 3,
	};
}

export function draftFromHabit(habit: Habit): HabitDraft {
	return {
		kind: habit.kind,
		name: habit.name,
		emoji: habit.emoji,
		color: habit.color,
		// Legacy "✨" habits arrive here already upgraded to auto (spec §2.3, D12).
		emojiAuto: habit.emojiAuto === true,
		// An existing habit keeps its color when its identity changes.
		colorAuto: false,
		identityId: habit.identityId,
		newIdentity: null,
		newIdentityEmoji: null,
		newIdentityColor: null,
		template: null,
		...scheduleFields(habit.schedule),
		timeOfDay: habit.timeOfDay,
		cueTime: text(habit.cueTime),
		cueLocation: text(habit.cueLocation),
		stackAfter: text(habit.stackAfter),
		twoMinute: text(habit.twoMinute),
		target: habit.target,
		unit: text(habit.unit),
		bundle: text(habit.bundle),
		reward: text(habit.reward),
		environment: text(habit.environment),
		why: text(habit.why),
		setupTasks: [],
		// A tracker from a newer build (unknown type) stays out of the form and untouched.
		tracker: knownTracker(habit),
	};
}

/**
 * Apply a template while keeping the chosen identity, the icon and color
 * choices and any setup task drafts (spec §5.4, amends Annex H): an auto icon
 * stays the identity's, and the template's emoji is offered as a chip.
 */
export function applyTemplate(draft: HabitDraft, template: HabitTemplate): HabitDraft {
	return {
		...draft,
		kind: template.kind,
		name: template.name,
		template: { key: template.key, emoji: template.emoji, color: template.color },
		setupTasks:
			template.kind === draft.kind
				? draft.setupTasks
				: pruneSetupDrafts(draft.setupTasks, template.kind),
		...scheduleFields(template.schedule),
		timeOfDay: template.timeOfDay,
		cueTime: text(template.cueTime),
		cueLocation: text(template.cueLocation),
		stackAfter: text(template.stackAfter),
		twoMinute: text(template.twoMinute),
		target: template.target,
		unit: text(template.unit),
		bundle: text(template.bundle),
		reward: text(template.reward),
		environment: text(template.environment),
		tracker: template.tracker,
	};
}

function toSchedule(draft: HabitDraft): Schedule {
	if (draft.kind === "break") return { type: "daily" };
	if (draft.scheduleType === "weekdays") {
		const days = [...new Set(draft.days)].sort();
		return days.length === 0 || days.length === 7 ? { type: "daily" } : { type: "weekdays", days };
	}
	if (draft.scheduleType === "weekly")
		return { type: "weekly", times: Math.min(7, Math.max(1, draft.times)) };
	return { type: "daily" };
}

/**
 * Form → store input (pass a draft resolved by `withDraftLook`). Break habits
 * are tracked daily by slips (no goal). An auto icon is sent resolved, and
 * the store derives it again from the saved identity.
 */
export function draftToInput(draft: HabitDraft, identityId: string | null): HabitInput {
	const isBreak = draft.kind === "break";
	return {
		kind: draft.kind,
		name: draft.name,
		emoji: draft.emoji || DEFAULT_HABIT_EMOJI[draft.kind],
		emojiAuto: draft.emojiAuto,
		color: draft.color,
		identityId,
		schedule: toSchedule(draft),
		timeOfDay: isBreak ? "anytime" : draft.timeOfDay,
		cueTime: !isBreak && draft.cueTime ? draft.cueTime : null,
		cueLocation: draft.cueLocation,
		stackAfter: isBreak ? null : draft.stackAfter,
		twoMinute: draft.twoMinute,
		target: isBreak ? 1 : draft.target,
		unit: isBreak || draft.target <= 1 ? null : draft.unit,
		bundle: draft.bundle,
		reward: draft.reward,
		environment: draft.environment,
		why: isBreak ? null : draft.why,
		// Sent only when set: an absent key leaves the habit's tracker (known or foreign) as it is.
		...(draft.tracker ? { tracker: draft.tracker } : {}),
	};
}

const orNull = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);

/** A full Habit for the live preview (ring + blueprint). */
export function previewHabit(draft: HabitDraft, fallbackName: string, today: DayKey): Habit {
	const input = draftToInput(draft, draft.identityId);
	return {
		id: "preview",
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
		archivedAt: null,
		order: 0,
		reminder: false,
		startDate: today,
		kind: draft.kind,
		name: draft.name.trim() || fallbackName,
		emoji: input.emoji ?? DEFAULT_HABIT_EMOJI[draft.kind],
		color: draft.color,
		identityId: draft.identityId,
		target: input.target ?? 1,
		unit: orNull(input.unit),
		schedule: input.schedule ?? { type: "daily" },
		timeOfDay: input.timeOfDay ?? "anytime",
		cueTime: input.cueTime ?? null,
		cueLocation: orNull(input.cueLocation),
		stackAfter: orNull(input.stackAfter),
		twoMinute: orNull(input.twoMinute),
		bundle: orNull(input.bundle),
		reward: orNull(input.reward),
		environment: orNull(input.environment),
		why: orNull(input.why),
		emojiAuto: draft.emojiAuto,
		goalHistory: [],
		levelUp: null,
		tracker: null,
		lang: null,
	};
}

// ── Icon and color (Annex H §1.2, D12) ──────────────────────────────────────

/** The identity a draft links (or will create on save), as far as its look goes. */
export interface DraftIdentity {
	statement: string;
	emoji: string;
	color: HabitColor | null;
	/** The stored identity; absent for one the save will create. */
	identity?: Identity;
}

let templateIdentities: IdentityTemplate[] | null = null;

/** The identity template a statement matches (en or pt, ignoring case and accents). */
export function identityTemplateFor(identity: {
	statement: string;
	emoji?: string | null;
}): IdentityTemplate | null {
	const key = matchIdentityTemplate(identity);
	if (!key) return null;
	// Emoji and colors don't depend on the language.
	templateIdentities ??= identityTemplates("en");
	return templateIdentities.find((tpl) => tpl.key === key) ?? null;
}

/** New identities get this icon when nothing else gives one (the store's default too). */
export const NEW_IDENTITY_EMOJI = "🌱";

export function draftIdentity(
	draft: HabitDraft,
	identities: readonly Identity[],
): DraftIdentity | null {
	if (draft.newIdentity !== null) {
		const statement = draft.newIdentity.trim();
		if (!statement) return null;
		const matched = identityTemplateFor({ statement });
		return {
			statement,
			emoji: draft.newIdentityEmoji ?? matched?.emoji ?? NEW_IDENTITY_EMOJI,
			color: draft.newIdentityColor ?? matched?.color ?? null,
		};
	}
	const identity = draft.identityId
		? identities.find((item) => item.id === draft.identityId)
		: undefined;
	return identity
		? { statement: identity.statement, emoji: identity.emoji, color: identity.color, identity }
		: null;
}

export interface DraftLook {
	emoji: string;
	color: HabitColor;
	/** The icon auto gives: the identity's emoji, else the kind default (🌱 / 🚫). */
	autoEmoji: string;
	/** Where the auto icon comes from, for the picker's caption and reset. */
	source: "identity" | "default";
}

/** The icon and color the habit gets, following `emojiAuto` / `colorAuto`. */
export function resolveDraftLook(draft: HabitDraft, identities: readonly Identity[]): DraftLook {
	const identity = draftIdentity(draft, identities);
	const autoEmoji = autoHabitEmoji(draft.kind, identity?.emoji);
	const autoColor = identity?.color ?? draft.template?.color ?? KIND_COLOR[draft.kind];
	return {
		emoji: draft.emojiAuto ? autoEmoji : draft.emoji || autoEmoji,
		color: draft.colorAuto ? autoColor : draft.color,
		autoEmoji,
		source: identity ? "identity" : "default",
	};
}

/** The draft with its resolved icon and color (the same object when nothing changes). */
export function withDraftLook(draft: HabitDraft, identities: readonly Identity[]): HabitDraft {
	const { emoji, color } = resolveDraftLook(draft, identities);
	return emoji === draft.emoji && color === draft.color ? draft : { ...draft, emoji, color };
}
