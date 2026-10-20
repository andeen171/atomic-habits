import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { type HabitTemplate, habitTemplates, identityTemplates } from "@atomic/core";
import { useIdentities, useLocale } from "@atomic/core/react";
import { Check, Plus } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { TrackerBadge } from "../trackers/tracker-badge";
import { TrackerField } from "../trackers/tracker-picker";
import { Field, Input } from "../ui/field";
import type { HabitDraft } from "./draft";
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
	return (
		<div className="flex flex-col gap-5">
			{editing ? (
				<KindReadOnly value={draft.kind} />
			) : (
				<KindToggle
					value={draft.kind}
					onChange={(kind) =>
						update(
							kind === "break"
								? {
										kind,
										color: draft.color === "ember" ? "rose" : draft.color,
										emoji: draft.emoji === "✨" ? "📵" : draft.emoji,
									}
								: { kind },
						)
					}
				/>
			)}
			<Field label={t("form.name")} error={nameError ? t("form.nameRequired") : undefined}>
				{(props) => (
					<div className="flex items-center gap-2.5">
						<EmojiPicker
							value={draft.emoji}
							color={draft.color}
							onChange={(emoji) => update({ emoji })}
						/>
						<Input
							{...props}
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
					</div>
				)}
			</Field>
			<div className="flex flex-col gap-2">
				<span className="font-medium text-ink text-small">{t("form.color")}</span>
				<ColorPicker value={draft.color} onChange={(color) => update({ color })} />
			</div>
		</div>
	);
}

export function TemplateList({
	draft,
	onPick,
}: { draft: HabitDraft; onPick(template: HabitTemplate): void }) {
	const { t } = useT();
	const locale = useLocale();
	const templates = useMemo(
		() => habitTemplates(locale).filter((tpl) => tpl.kind === draft.kind),
		[locale, draft.kind],
	);
	if (!templates.length) return null;
	return (
		<section className="mt-8">
			<h3 className="font-semibold text-ink">{t("form.templates")}</h3>
			<p className="mb-3 text-ink-muted text-small">{t("form.templatesHint")}</p>
			<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
				{templates.map((tpl) => (
					<TemplateButton
						key={tpl.key}
						template={tpl}
						selected={draft.name === tpl.name}
						onPick={() => onPick(tpl)}
					/>
				))}
			</div>
		</section>
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
				"flex items-center gap-3 rounded-lg border bg-surface p-3 text-left transition-colors duration-(--atomic-duration-fast)",
				selected ? "border-accent" : "border-line hover:border-line-strong hover:bg-hover/50",
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

export function IdentityFields({ draft, update }: StepProps) {
	const { t } = useT();
	const identities = useIdentities();
	const locale = useLocale();
	const suggestions = useMemo(() => {
		const existing = new Set(identities.map((i) => i.statement.toLowerCase()));
		return identityTemplates(locale).filter((tpl) => !existing.has(tpl.statement.toLowerCase()));
	}, [identities, locale]);
	const creating = draft.newIdentity !== null;

	return (
		<fieldset className="flex min-w-0 flex-col gap-2">
			<legend className="sr-only">{t("form.identity")}</legend>
			{identities.map((identity) => (
				<OptionCard
					key={identity.id}
					selected={!creating && draft.identityId === identity.id}
					onClick={() => update({ identityId: identity.id, newIdentity: null })}
					icon={<span className="font-emoji text-lg">{identity.emoji}</span>}
					label={identity.statement}
				/>
			))}
			<OptionCard
				selected={!creating && draft.identityId === null}
				onClick={() => update({ identityId: null, newIdentity: null })}
				icon={<span className="size-2 rounded-full bg-line-strong" />}
				label={t("form.identityNone")}
				muted
			/>
			<div
				className={cn(
					"rounded-lg border bg-surface p-3 transition-colors",
					creating ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-line border-dashed",
				)}
			>
				{creating ? (
					<div className="flex flex-col gap-3">
						<Input
							value={draft.newIdentity ?? ""}
							autoFocus
							maxLength={120}
							aria-label={t("form.identityNew")}
							placeholder={t("form.identityPlaceholder")}
							onChange={(event) => update({ newIdentity: event.target.value })}
						/>
						{suggestions.length ? (
							<div>
								<p className="section-label mb-2">{t("identity.suggestions")}</p>
								<div className="flex flex-wrap gap-1.5">
									{suggestions.map((tpl) => (
										<button
											key={tpl.key}
											type="button"
											onClick={() => update({ newIdentity: tpl.statement })}
											className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-ink-muted text-small transition-colors hover:border-line-strong hover:text-ink"
										>
											<span className="font-emoji">{tpl.emoji}</span>
											{tpl.statement}
										</button>
									))}
								</div>
							</div>
						) : null}
					</div>
				) : (
					<button
						type="button"
						onClick={() => update({ newIdentity: "" })}
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

function OptionCard({
	selected,
	onClick,
	icon,
	label,
	muted,
}: {
	selected: boolean;
	onClick(): void;
	icon: ReactNode;
	label: string;
	muted?: boolean;
}) {
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onClick}
			className={cn(
				"flex items-center gap-3 rounded-lg border bg-surface p-3 text-left transition-[border-color,box-shadow] duration-(--atomic-duration-fast)",
				selected
					? "border-accent shadow-[0_0_0_1px_var(--accent)]"
					: "border-line hover:border-line-strong",
			)}
		>
			<span className="grid size-9 shrink-0 place-items-center rounded-full bg-sunken">{icon}</span>
			<span
				className={cn(
					"min-w-0 flex-1 font-medium text-small",
					muted ? "text-ink-muted" : "text-ink",
				)}
			>
				{label}
			</span>
			{selected ? <Check className="size-4 text-accent" strokeWidth={2.5} /> : null}
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
					value={draft.cueLocation}
					onChange={(cueLocation) => update({ cueLocation })}
					placeholder={t("form.triggerPlaceholder")}
					maxLength={120}
				/>
				<div className="flex flex-col gap-2">
					<DraftTextField
						label={t("form.invisible")}
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
				value={draft.stackAfter}
				onChange={(stackAfter) => update({ stackAfter })}
				placeholder={t("form.stackAfterPlaceholder")}
			/>
			<div className="flex flex-col gap-2">
				<DraftTextField
					label={t("form.environment")}
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
					<Input
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
					value={draft.bundle}
					onChange={(bundle) => update({ bundle })}
					placeholder={t("form.unattractivePlaceholder")}
				/>
				<div className="flex flex-col gap-2">
					<DraftTextField
						label={t("form.unsatisfying")}
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
				value={draft.bundle}
				onChange={(bundle) => update({ bundle })}
				placeholder={t("form.bundlePlaceholder")}
			/>
			<DraftTextField
				label={t("form.reward")}
				hint={t("form.rewardHint")}
				value={draft.reward}
				onChange={(reward) => update({ reward })}
				placeholder={t("form.rewardPlaceholder")}
			/>
			<DraftTextField
				label={t("form.why")}
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
