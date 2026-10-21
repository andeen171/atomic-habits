import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
	type HabitColor,
	type HabitTemplate,
	habitTemplates,
	identityTemplates,
	pruneSetupDrafts,
} from "@atomic/core";
import { useIdentities, useLocale, useText } from "@atomic/core/react";
import { Check, ChevronDown, Link2, Plus, RotateCcw } from "lucide-react";
import { type ReactNode, useId, useMemo, useState } from "react";
import { AiSuggest } from "../ai/ai-suggest";
import { TrackerBadge } from "../trackers/tracker-badge";
import { TrackerField } from "../trackers/tracker-picker";
import { Chip } from "../ui/chip";
import { Field } from "../ui/field";
import { SmartInput } from "../ui/smart-input";
import {
	type HabitDraft,
	NEW_IDENTITY_EMOJI,
	draftIdentity,
	identityTemplateFor,
	resolveDraftLook,
} from "./draft";
import {
	ColorPicker,
	CueTimeField,
	DraftTextField,
	type DraftUpdate,
	EmojiPicker,
	FrequencyField,
	KindReadOnly,
	KindToggle,
	Stepper,
	TimeOfDayField,
} from "./editor-fields";
import { SetupTaskAdder } from "./setup-task-adder";
import { SetupTaskToggle } from "./setup-task-toggle";

export interface StepProps {
	draft: HabitDraft;
	update: DraftUpdate;
	/** The habit being edited (edit mode); setup-task toggles show its linked tasks. */
	habitId?: string;
}

export function BasicsFields({
	draft,
	update,
	nameError,
	onNameEnter,
	autoFocus,
	editing,
}: StepProps & {
	nameError: boolean;
	onNameEnter?(): void;
	autoFocus?: boolean;
	/** An existing habit: its kind is shown but can't change. */
	editing?: boolean;
}) {
	const { t } = useT();
	const isBreak = draft.kind === "break";
	const identities = useIdentities();
	const look = resolveDraftLook(draft, identities);
	const identityStatement = draftIdentity(draft, identities)?.statement;
	const resetIcon = () => update({ emojiAuto: true });
	return (
		<div className="flex flex-col gap-5">
			{editing ? (
				<KindReadOnly value={draft.kind} />
			) : (
				<KindToggle
					value={draft.kind}
					onChange={(kind) => {
						if (kind === draft.kind) return;
						// Auto icon and color follow the kind (🌱 / 🚫); the other kind's template doesn't apply.
						update({
							kind,
							template: null,
							setupTasks: pruneSetupDrafts(draft.setupTasks, kind),
						});
					}}
				/>
			)}
			<Field label={t("form.name")} error={nameError ? t("form.nameRequired") : undefined}>
				{(props) => (
					<div className="flex items-center gap-2.5">
						<EmojiPicker
							value={draft.emoji}
							color={draft.color}
							onChange={(emoji) => update({ emoji, emojiAuto: false })}
							auto={{
								on: draft.emojiAuto,
								source: look.source,
								emoji: look.autoEmoji,
								onReset: resetIcon,
							}}
						/>
						<SmartInput
							{...props}
							field="habit.name"
							value={draft.name}
							maxLength={120}
							autoFocus={autoFocus}
							placeholder={isBreak ? t("form.namePlaceholderBreak") : t("form.namePlaceholder")}
							onChange={(event) => update({ name: event.target.value })}
							onKeyDown={(event) => {
								if (event.key === "Enter" && onNameEnter) {
									event.preventDefault();
									onNameEnter();
								}
							}}
							className="text-h3"
						/>
						<AiSuggest
							kind="habit.name"
							label={t("form.name")}
							input={() => ({
								partial: draft.name.trim().slice(0, 80) || undefined,
								identity: identityStatement?.slice(0, 120),
								kind: draft.kind,
							})}
							onPick={(name) => update({ name })}
						/>
					</div>
				)}
			</Field>
			<IconSource draft={draft} look={look} update={update} onReset={resetIcon} />
			<div className="flex flex-col gap-2">
				<span className="font-medium text-ink text-small">{t("form.color")}</span>
				<ColorPicker
					value={draft.color}
					onChange={(color) => update({ color, colorAuto: false })}
				/>
			</div>
		</div>
	);
}

/**
 * Where the icon comes from (D12): "Matches your identity" / "Default icon"
 * while auto, a reset back to it once the user picked one, and the applied
 * template's emoji as a one-tap "Use 📖" chip.
 */
function IconSource({
	draft,
	look,
	update,
	onReset,
}: StepProps & { look: ReturnType<typeof resolveDraftLook>; onReset(): void }) {
	const { t } = useT();
	const templateEmoji = draft.template?.emoji;
	const offerTemplate = templateEmoji && templateEmoji !== draft.emoji ? templateEmoji : null;
	const fromIdentity = look.source === "identity";
	return (
		<div className="-mt-2 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
			{draft.emojiAuto ? (
				<p className="inline-flex min-w-0 items-center gap-1.5 text-ink-subtle text-small">
					<Link2 aria-hidden="true" className="size-3.5 shrink-0" />
					{t(fromIdentity ? "form.emojiAuto" : "form.emojiAutoKind")}
				</p>
			) : (
				<button
					type="button"
					onClick={onReset}
					className="-ml-2 inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full px-2 font-medium text-ink-muted text-small transition-colors duration-(--atomic-duration-fast) hover:bg-hover hover:text-ink"
				>
					<RotateCcw aria-hidden="true" className="size-3.5 shrink-0" />
					<span className="min-w-0 break-words">
						{t(fromIdentity ? "form.emojiUseIdentity" : "form.emojiUseDefault")}
					</span>
					<span aria-hidden="true" className="font-emoji text-base leading-none">
						{look.autoEmoji}
					</span>
				</button>
			)}
			{offerTemplate ? (
				<Chip onClick={() => update({ emoji: offerTemplate, emojiAuto: false })}>
					{t("form.emojiUseTemplate", { emoji: offerTemplate })}
				</Chip>
			) : null}
		</div>
	);
}

/**
 * "Fill the four laws" (AI, Beta): one suggestion per law, written only into
 * the fields that are still empty (spec §5.4).
 */
export function FillLawsButton({ draft, update }: StepProps) {
	const { t } = useT();
	const identities = useIdentities();
	const name = draft.name.trim();
	return (
		<AiSuggest
			kind="habit.laws"
			label={t("form.fillLaws")}
			disabled={!name}
			input={() => ({
				habit: name.slice(0, 120),
				kind: draft.kind,
				identity: draftIdentity(draft, identities)?.statement.slice(0, 120),
			})}
			onPick={(laws) => {
				const patch: Partial<HabitDraft> = {};
				// Break habits get the inverted laws in the same slots (invisible, unattractive, difficult, unsatisfying).
				if (!draft.environment.trim()) patch.environment = laws.obvious;
				if (!draft.bundle.trim()) patch.bundle = laws.attractive;
				if (!draft.twoMinute.trim()) patch.twoMinute = laws.easy;
				if (!draft.reward.trim()) patch.reward = laws.satisfying;
				if (Object.keys(patch).length) update(patch);
			}}
		/>
	);
}

/**
 * Templates of the habit's kind. With an identity that matches a template
 * identity, its habits come first as "Ideas for “{identity}”" and the rest
 * fold under "More ideas" (Annex H §1.2).
 */
export function TemplateList({
	draft,
	onPick,
}: { draft: HabitDraft; onPick(template: HabitTemplate): void }) {
	const { t } = useT();
	const locale = useLocale();
	const text = useText();
	const identities = useIdentities();
	const identity = draftIdentity(draft, identities);
	const matchedKey = identity ? (identityTemplateFor(identity)?.key ?? null) : null;
	const { ideas, rest } = useMemo(() => {
		const ofKind = habitTemplates(locale).filter((tpl) => tpl.kind === draft.kind);
		const matched = matchedKey
			? identityTemplates(locale).find((tpl) => tpl.key === matchedKey)
			: undefined;
		const keys = new Set(
			matched?.habits.filter((tpl) => tpl.kind === draft.kind).map((tpl) => tpl.key),
		);
		return {
			ideas: ofKind.filter((tpl) => keys.has(tpl.key)),
			rest: ofKind.filter((tpl) => !keys.has(tpl.key)),
		};
	}, [locale, draft.kind, matchedKey]);
	if (!ideas.length && !rest.length) return null;

	const grid = (templates: HabitTemplate[]) => (
		<ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
			{templates.map((tpl) => (
				<li key={tpl.key} className="flex">
					<TemplateButton
						template={tpl}
						selected={draft.template?.key === tpl.key}
						onPick={() => onPick(tpl)}
					/>
				</li>
			))}
		</ul>
	);

	if (!ideas.length || !identity) {
		return (
			<section className="mt-8">
				<h3 className="font-semibold text-ink">{t("form.templates")}</h3>
				<p className="mb-3 text-ink-muted text-small">{t("form.templatesHint")}</p>
				{grid(rest)}
			</section>
		);
	}
	const statement = identity.identity
		? text.identity(identity.identity, "statement")
		: identity.statement;
	return (
		<section className="mt-8">
			<h3 className="text-balance break-words font-semibold text-ink">
				{t("form.templatesFor", { identity: statement })}
			</h3>
			<p className="mb-3 text-ink-muted text-small">{t("form.templatesHint")}</p>
			{grid(ideas)}
			{rest.length ? <MoreIdeas count={rest.length}>{grid(rest)}</MoreIdeas> : null}
		</section>
	);
}

function MoreIdeas({ count, children }: { count: number; children: ReactNode }) {
	const { t } = useT();
	const [open, setOpen] = useState(false);
	const id = useId();
	return (
		<div className="mt-4">
			<button
				type="button"
				aria-expanded={open}
				aria-controls={id}
				onClick={() => setOpen((value) => !value)}
				className="-ml-2 inline-flex h-9 items-center gap-1.5 rounded-full px-2 font-medium text-ink-muted text-small transition-colors duration-(--atomic-duration-fast) hover:bg-hover hover:text-ink"
			>
				<ChevronDown
					aria-hidden="true"
					className={cn(
						"size-4 transition-transform duration-(--atomic-duration-fast)",
						open ? "rotate-180" : "",
					)}
				/>
				{t("form.templatesMore")}
				<span className="text-ink-subtle tabular-nums">{t.number(count)}</span>
			</button>
			<div id={id} hidden={!open} className="mt-2">
				{open ? children : null}
			</div>
		</div>
	);
}

function TemplateButton({
	template,
	selected,
	onPick,
}: { template: HabitTemplate; selected: boolean; onPick(): void }) {
	const style = useHabitStyle(template.color);
	return (
		<button
			type="button"
			onClick={onPick}
			aria-pressed={selected}
			style={style}
			className={cn(
				"flex w-full items-center gap-3 rounded-lg border bg-surface p-3 text-left transition-[border-color,box-shadow,background-color] duration-(--atomic-duration-fast)",
				selected
					? "border-accent shadow-[0_0_0_1px_var(--accent)]"
					: "border-line hover:border-line-strong hover:bg-hover/50",
			)}
		>
			<span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--habit-soft) font-emoji text-lg">
				{template.emoji}
			</span>
			<span className="min-w-0 flex-1">
				<span className="line-clamp-2 block break-words font-medium text-ink text-small">
					{template.name}
				</span>
				{template.twoMinute ? (
					<span className="line-clamp-2 block break-words text-ink-subtle text-small italic">
						{template.twoMinute}
					</span>
				) : null}
				<TrackerBadge template={template} className="mt-1" />
			</span>
		</button>
	);
}

/**
 * Step 1 (Annex H §1.2): an existing identity, "No identity", or a new one.
 * A suggestion chip sets the new identity's statement, icon and color; the
 * habit's auto icon and color follow whatever is chosen here.
 */
export function IdentityFields({ draft, update }: StepProps) {
	const { t } = useT();
	const text = useText();
	const identities = useIdentities();
	const locale = useLocale();
	const suggestions = useMemo(() => {
		const taken = new Set(identities.map((identity) => identityTemplateFor(identity)?.key));
		return identityTemplates(locale).filter((tpl) => !taken.has(tpl.key));
	}, [identities, locale]);
	const creating = draft.newIdentity !== null;
	const created = creating ? draftIdentity(draft, identities) : null;
	const statement = draft.newIdentity ?? "";

	return (
		<fieldset className="flex min-w-0 flex-col gap-2">
			<legend className="sr-only">{t("form.identity")}</legend>
			{identities.map((identity) => (
				<OptionCard
					key={identity.id}
					selected={!creating && draft.identityId === identity.id}
					onClick={() => update({ identityId: identity.id, newIdentity: null })}
					icon={<span className="font-emoji text-lg">{identity.emoji}</span>}
					color={identity.color}
					label={text.identity(identity, "statement")}
				/>
			))}
			<OptionCard
				selected={!creating && draft.identityId === null}
				onClick={() => update({ identityId: null, newIdentity: null })}
				icon={<span className="size-2 rounded-full bg-line-strong" />}
				label={t("form.identityNone")}
				hint={t("form.identityNoneHint")}
				muted
			/>
			<div
				className={cn(
					"rounded-lg border bg-surface p-3 transition-[border-color,box-shadow] duration-(--atomic-duration-fast)",
					creating ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-line border-dashed",
				)}
			>
				{creating ? (
					<div className="flex flex-col gap-3">
						<div className="flex items-center gap-2.5">
							<EmojiPicker
								value={created?.emoji ?? draft.newIdentityEmoji ?? NEW_IDENTITY_EMOJI}
								color={created?.color ?? draft.color}
								onChange={(emoji) => update({ newIdentityEmoji: emoji })}
								label={`${t("form.emoji")} · ${t("form.identityNew")}`}
							/>
							<SmartInput
								field="identity.statement"
								value={statement}
								autoFocus
								maxLength={120}
								aria-label={t("form.identityNew")}
								placeholder={t("form.identityPlaceholder")}
								onChange={(event) => {
									const value = event.target.value;
									// An emptied field forgets the chip's icon and color.
									update(
										value.trim()
											? { newIdentity: value }
											: { newIdentity: value, newIdentityEmoji: null, newIdentityColor: null },
									);
								}}
							/>
							<AiSuggest
								kind="identity.statement"
								label={t("form.identity")}
								disabled={statement.trim().length < 2}
								input={() => ({ goal: statement.trim().slice(0, 160) })}
								onPick={(pick) => update({ newIdentity: pick })}
							/>
						</div>
						{suggestions.length ? (
							<div>
								<p className="section-label mb-2">{t("identity.suggestions")}</p>
								<div className="flex flex-wrap gap-1.5">
									{suggestions.map((tpl) => (
										<IdentityChip
											key={tpl.key}
											emoji={tpl.emoji}
											color={tpl.color}
											label={tpl.statement}
											selected={statement.trim() === tpl.statement}
											onClick={() =>
												update({
													newIdentity: tpl.statement,
													newIdentityEmoji: tpl.emoji,
													newIdentityColor: tpl.color,
												})
											}
										/>
									))}
								</div>
							</div>
						) : null}
					</div>
				) : (
					<button
						type="button"
						onClick={() => update({ newIdentity: "", identityId: null })}
						className="flex w-full items-center gap-3 text-left text-ink-muted transition-colors hover:text-ink"
					>
						<span className="grid size-9 place-items-center rounded-full bg-sunken">
							<Plus className="size-4" />
						</span>
						<span className="font-medium text-small">{t("form.identityNew")}</span>
					</button>
				)}
			</div>
		</fieldset>
	);
}

function IdentityChip({
	emoji,
	color,
	label,
	selected,
	onClick,
}: {
	emoji: string;
	color: HabitColor;
	label: string;
	selected: boolean;
	onClick(): void;
}) {
	const style = useHabitStyle(color);
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onClick}
			style={style}
			className={cn(
				"inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border py-1 pr-3 pl-1 text-left text-small transition-colors duration-(--atomic-duration-fast)",
				selected
					? "border-accent bg-accent-soft text-ink"
					: "border-line text-ink-muted hover:border-line-strong hover:text-ink",
			)}
		>
			<span
				aria-hidden="true"
				className="grid size-6 shrink-0 place-items-center rounded-full bg-(--habit-soft) font-emoji text-[13px]"
			>
				{emoji}
			</span>
			<span className="min-w-0 break-words">{label}</span>
		</button>
	);
}

function OptionCard({
	selected,
	onClick,
	icon,
	color,
	label,
	hint,
	muted,
}: {
	selected: boolean;
	onClick(): void;
	icon: ReactNode;
	/** Tints the icon circle (an identity's color). */
	color?: HabitColor;
	label: string;
	hint?: string;
	muted?: boolean;
}) {
	const style = useHabitStyle(color ?? "ember");
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onClick}
			style={color ? style : undefined}
			className={cn(
				"flex items-center gap-3 rounded-lg border bg-surface p-3 text-left transition-[border-color,box-shadow] duration-(--atomic-duration-fast)",
				selected
					? "border-accent shadow-[0_0_0_1px_var(--accent)]"
					: "border-line hover:border-line-strong",
			)}
		>
			<span
				className={cn(
					"grid size-9 shrink-0 place-items-center rounded-full",
					color ? "bg-(--habit-soft)" : "bg-sunken",
				)}
			>
				{icon}
			</span>
			<span className="min-w-0 flex-1">
				<span
					className={cn(
						"block break-words font-medium text-small",
						muted ? "text-ink-muted" : "text-ink",
					)}
				>
					{label}
				</span>
				{hint ? (
					<span className="block break-words text-ink-subtle text-small leading-snug">{hint}</span>
				) : null}
			</span>
			{selected ? <Check className="size-4 shrink-0 text-accent" strokeWidth={2.5} /> : null}
		</button>
	);
}

/** Law 1. Build: when, where, stacking and the environment (D13). Break: the trigger and making it invisible. */
export function ObviousFields({ draft, update, habitId }: StepProps) {
	const { t } = useT();
	if (draft.kind === "break") {
		return (
			<div className="flex flex-col gap-5">
				<DraftTextField
					label={t("form.trigger")}
					field="habit.cueLocation"
					value={draft.cueLocation}
					onChange={(cueLocation) => update({ cueLocation })}
					placeholder={t("form.triggerPlaceholder")}
					maxLength={120}
				/>
				<div className="flex flex-col gap-2">
					<DraftTextField
						label={t("form.invisible")}
						field="habit.environment"
						value={draft.environment}
						onChange={(environment) => update({ environment })}
						placeholder={t("form.invisiblePlaceholder")}
						maxLength={280}
					/>
					<SetupTaskToggle field="environment" draft={draft} update={update} habitId={habitId} />
				</div>
				<SetupTaskAdder law={1} draft={draft} update={update} />
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-6">
			<FrequencyField draft={draft} update={update} />
			<TimeOfDayField value={draft.timeOfDay} onChange={(timeOfDay) => update({ timeOfDay })} />
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
				<CueTimeField value={draft.cueTime} onChange={(cueTime) => update({ cueTime })} />
				<DraftTextField
					label={t("form.cueLocation")}
					field="habit.cueLocation"
					suggest={
						<AiSuggest
							kind="habit.intention"
							label={t("form.cueLocation")}
							input={() => ({
								habit: draft.name.trim(),
								kind: draft.kind,
								timeOfDay: draft.timeOfDay,
							})}
							onPick={(intention) =>
								update({
									cueLocation: intention.location,
									...(intention.time ? { cueTime: intention.time } : {}),
								})
							}
						/>
					}
					value={draft.cueLocation}
					onChange={(cueLocation) => update({ cueLocation })}
					placeholder={t("form.cueLocationPlaceholder")}
					maxLength={120}
				/>
			</div>
			<DraftTextField
				label={t("form.stackAfter")}
				hint={t("form.stackAfterHint")}
				prefix={t("form.stackAfterPrefix")}
				field="habit.stackAfter"
				suggest={
					<AiSuggest
						kind="habit.stack"
						label={t("form.stackAfter")}
						input={() => ({ habit: draft.name.trim() })}
						onPick={(stackAfter) => update({ stackAfter })}
					/>
				}
				value={draft.stackAfter}
				onChange={(stackAfter) => update({ stackAfter })}
				placeholder={t("form.stackAfterPlaceholder")}
			/>
			<div className="flex flex-col gap-2">
				<DraftTextField
					label={t("form.environment")}
					field="habit.environment"
					value={draft.environment}
					onChange={(environment) => update({ environment })}
					placeholder={t("form.environmentPlaceholder")}
					maxLength={280}
				/>
				<SetupTaskToggle field="environment" draft={draft} update={update} habitId={habitId} />
			</div>
			<SetupTaskAdder law={1} draft={draft} update={update} />
		</div>
	);
}

/** Law 3. Build: the two-minute version, how it is logged and the daily goal. Break: adding friction. */
export function EasyFields({ draft, update, habitId }: StepProps) {
	const { t } = useT();
	if (draft.kind === "break") {
		return (
			<div className="flex flex-col gap-5">
				<div className="flex flex-col gap-2">
					<DraftTextField
						label={t("form.difficult")}
						field="habit.twoMinute"
						value={draft.twoMinute}
						onChange={(twoMinute) => update({ twoMinute })}
						placeholder={t("form.difficultPlaceholder")}
					/>
					<SetupTaskToggle field="twoMinute" draft={draft} update={update} habitId={habitId} />
				</div>
				{/* Break habits: the slip tracker only. */}
				<TrackerField draft={draft} update={update} />
				<SetupTaskAdder law={3} draft={draft} update={update} />
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-6">
			<DraftTextField
				label={t("form.twoMinute")}
				field="habit.twoMinute"
				suggest={
					<AiSuggest
						kind="habit.twoMinute"
						label={t("form.twoMinute")}
						input={() => ({ habit: draft.name.trim(), kind: draft.kind })}
						onPick={(twoMinute) => update({ twoMinute })}
					/>
				}
				value={draft.twoMinute}
				onChange={(twoMinute) => update({ twoMinute })}
				placeholder={t("form.twoMinutePlaceholder")}
			/>
			<TrackerField draft={draft} update={update} />
			<div className="flex flex-col gap-2">
				<span className="font-medium text-ink text-small">{t("form.target")}</span>
				<p className="-mt-1 text-ink-subtle text-small">{t("form.targetHint")}</p>
				<div className="flex flex-wrap items-center gap-3">
					<Stepper
						value={draft.target}
						min={1}
						max={10_000}
						onChange={(target) => update({ target })}
						label={t("form.target")}
					/>
					<SmartInput
						field="habit.unit"
						value={draft.unit}
						maxLength={24}
						disabled={draft.target <= 1}
						aria-label={t("form.unit")}
						placeholder={t("form.unitPlaceholder")}
						onChange={(event) => update({ unit: event.target.value })}
						className="max-w-56 flex-1"
					/>
				</div>
			</div>
			<SetupTaskAdder law={3} draft={draft} update={update} />
		</div>
	);
}

/** Laws 2 and 4. Build: bundling, reward and the reason. Break: unattractive and unsatisfying. */
export function SatisfyingFields({ draft, update, habitId }: StepProps) {
	const { t } = useT();
	if (draft.kind === "break") {
		return (
			<div className="flex flex-col gap-5">
				<DraftTextField
					label={t("form.unattractive")}
					field="habit.bundle"
					value={draft.bundle}
					onChange={(bundle) => update({ bundle })}
					placeholder={t("form.unattractivePlaceholder")}
				/>
				<div className="flex flex-col gap-2">
					<DraftTextField
						label={t("form.unsatisfying")}
						field="habit.reward"
						value={draft.reward}
						onChange={(reward) => update({ reward })}
						placeholder={t("form.unsatisfyingPlaceholder")}
					/>
					<SetupTaskToggle field="reward" draft={draft} update={update} habitId={habitId} />
				</div>
				<SetupTaskAdder law={2} draft={draft} update={update} />
				<SetupTaskAdder law={4} draft={draft} update={update} />
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-5">
			<DraftTextField
				label={t("form.bundle")}
				hint={t("form.bundleHint")}
				field="habit.bundle"
				value={draft.bundle}
				onChange={(bundle) => update({ bundle })}
				placeholder={t("form.bundlePlaceholder")}
			/>
			<DraftTextField
				label={t("form.reward")}
				hint={t("form.rewardHint")}
				field="habit.reward"
				value={draft.reward}
				onChange={(reward) => update({ reward })}
				placeholder={t("form.rewardPlaceholder")}
			/>
			<DraftTextField
				label={t("form.why")}
				field="habit.why"
				value={draft.why}
				onChange={(why) => update({ why })}
				placeholder={t("form.whyPlaceholder")}
				maxLength={280}
			/>
			<SetupTaskAdder law={2} draft={draft} update={update} />
			<SetupTaskAdder law={4} draft={draft} update={update} />
		</div>
	);
}
