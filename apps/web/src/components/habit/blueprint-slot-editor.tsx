import { announce } from "@/lib/announce";
import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import {
	type BlueprintField,
	type BlueprintSlot,
	type Habit,
	type HabitPatch,
	SETUP_FIELDS,
	type SetupField,
	blueprintPatch,
	lawHeading,
} from "@atomic/core";
import { useActions, useAtomicStore, useIdentity, useText } from "@atomic/core/react";
import { type ReactNode, type RefObject, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { AiSuggest } from "../ai/ai-suggest";
import { offerSetupRetitle } from "../editor/setup-shared";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
} from "../ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { SmartInput, SmartTextarea } from "../ui/smart-input";
import { TimeField } from "../ui/time-field";

export interface BlueprintSlotEditorProps {
	habit: Habit;
	slot: BlueprintSlot;
	open: boolean;
	onOpenChange(open: boolean): void;
}

/** The slot's text control, focused (and its text selected) when the editor opens. */
function focusField(form: HTMLElement | null): boolean {
	const el = form?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
	if (!el) return false;
	el.focus();
	try {
		if (el instanceof HTMLTextAreaElement || el.type === "text") {
			el.setSelectionRange(el.value.length, el.value.length);
		}
	} catch {
		// Time inputs have no text selection.
	}
	return true;
}

/**
 * md and up: the slot's editor in a popover anchored to its tile (Annex H
 * §1.3). Radix returns focus to the tile when it closes; Esc cancels.
 */
export function BlueprintSlotPopover({
	habit,
	slot,
	open,
	onOpenChange,
	children,
}: BlueprintSlotEditorProps & { children: ReactNode }) {
	const formRef = useRef<HTMLFormElement>(null);
	const titleId = useId();
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>{children}</PopoverTrigger>
			<PopoverContent
				align="start"
				aria-labelledby={titleId}
				className="w-[min(26rem,calc(100vw-2rem))] p-4"
				onOpenAutoFocus={(event) => {
					if (focusField(formRef.current)) event.preventDefault();
				}}
			>
				<SlotForm
					habit={habit}
					slot={slot}
					layout="popover"
					titleId={titleId}
					formRef={formRef}
					onDone={() => onOpenChange(false)}
				/>
			</PopoverContent>
		</Popover>
	);
}

/**
 * Phones: the slot's editor as a bottom sheet. `returnFocus` names the tile
 * that focus goes back to (also when "Fill next" opened it).
 */
export function BlueprintSlotDialog({
	habit,
	slot,
	open,
	onOpenChange,
	returnFocus,
}: BlueprintSlotEditorProps & { returnFocus?: () => HTMLElement | null }) {
	const formRef = useRef<HTMLFormElement>(null);
	const titleId = useId();
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				size="sm"
				onOpenAutoFocus={(event) => {
					if (focusField(formRef.current)) event.preventDefault();
				}}
				onCloseAutoFocus={(event) => {
					const tile = returnFocus?.();
					if (!tile?.isConnected) return;
					event.preventDefault();
					tile.focus();
				}}
			>
				<SlotForm
					habit={habit}
					slot={slot}
					layout="sheet"
					titleId={titleId}
					formRef={formRef}
					onDone={() => onOpenChange(false)}
				/>
			</DialogContent>
		</Dialog>
	);
}

const isSetupField = (field: BlueprintField): field is SetupField =>
	(SETUP_FIELDS as readonly string[]).includes(field);

interface SlotFormProps {
	habit: Habit;
	slot: BlueprintSlot;
	layout: "popover" | "sheet";
	titleId: string;
	formRef: RefObject<HTMLFormElement | null>;
	onDone(): void;
}

/**
 * Concept, "law · stage", hint, the input and Save / Cancel / Clear. Enter
 * saves (Ctrl/⌘+Enter in multi-line fields). Saving trims (empty clears),
 * announces "Blueprint updated", and offers to retitle a linked setup task
 * (spec §2.5). Clearing gives an Undo toast.
 */
function SlotForm({ habit, slot, layout, titleId, formRef, onDone }: SlotFormProps) {
	const { t } = useT();
	const actions = useActions();
	const store = useAtomicStore();
	const original = slot.value ?? "";
	const [draft, setDraft] = useState(original);
	const inputId = useId();
	const hintId = useId();
	const heading = lawHeading(slot.law, habit.kind, t);
	const concept = t(slot.concept);
	const hint = t(slot.hint);
	const multiline = slot.input === "multiline";
	const trimmed = draft.trim();
	const sheet = layout === "sheet";

	/** "Update the linked task too?" when a convertible field's text changed (spec §2.5; T2's offer). */
	const offerRetitle = () => {
		if (!isSetupField(slot.field)) return;
		const { data } = store.getState();
		const saved = data.habits[habit.id];
		if (saved) offerSetupRetitle(saved, slot.field, data.tasks, t, actions);
	};

	const save = () => {
		if (trimmed === original.trim()) {
			onDone();
			return;
		}
		const value = trimmed || null;
		const before = previousValues(habit, slot.field);
		actions.setBlueprintField(habit.id, slot.field, value);
		onDone();
		if (value === null) {
			toastCleared(before);
		} else {
			announce(t("blueprint.board.saved"));
			offerRetitle();
		}
	};

	const clear = () => {
		const before = previousValues(habit, slot.field);
		actions.setBlueprintField(habit.id, slot.field, null);
		onDone();
		toastCleared(before);
	};

	const toastCleared = (before: HabitPatch) => {
		toast(t("blueprint.board.saved"), {
			description: concept,
			action: {
				label: t("common.undo"),
				onClick: () => actions.updateHabit(habit.id, before),
			},
		});
	};

	// The sheet reads its hint as the dialog description instead.
	const describedBy = sheet ? undefined : hintId;
	const control = (() => {
		if (slot.input === "time") {
			return (
				<TimeField
					id={inputId}
					value={draft || null}
					clearable={false}
					aria-describedby={describedBy}
					onChange={(value) => setDraft(value ?? "")}
				/>
			);
		}
		if (multiline) {
			return (
				<SmartTextarea
					id={inputId}
					field={`habit.${slot.field}` as "habit.environment"}
					autoGrow
					minRows={3}
					maxRows={8}
					value={draft}
					maxLength={slot.maxLength}
					placeholder={t(slot.placeholder)}
					aria-describedby={describedBy}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
						event.preventDefault();
						save();
					}}
				/>
			);
		}
		if (slot.field === "stackAfter") {
			return (
				<div className="flex items-center rounded-md border border-line bg-sunken/60 pl-3.5 transition-colors focus-within:border-accent focus-within:bg-surface focus-within:ring-3 focus-within:ring-accent/15 hover:border-line-strong">
					<span aria-hidden="true" className="shrink-0 text-ink-muted">
						{t("form.stackAfterPrefix")}
					</span>
					<input
						id={inputId}
						type="text"
						value={draft}
						maxLength={slot.maxLength}
						placeholder={t(slot.placeholder)}
						aria-describedby={describedBy}
						onChange={(event) => setDraft(event.target.value)}
						className="h-11 min-w-0 flex-1 bg-transparent px-2 text-body text-ink outline-none placeholder:text-ink-subtle focus-visible:outline-none"
					/>
				</div>
			);
		}
		return (
			<SmartInput
				id={inputId}
				type="text"
				field={`habit.${slot.field}` as "habit.cueLocation"}
				value={draft}
				maxLength={slot.maxLength}
				placeholder={t(slot.placeholder)}
				aria-describedby={describedBy}
				onChange={(event) => setDraft(event.target.value)}
			/>
		);
	})();

	const counter =
		slot.input !== "time" && draft.length > slot.maxLength * 0.8 ? (
			<span className="text-ink-muted text-tiny tabular-nums">
				{t.number(draft.length)}/{t.number(slot.maxLength)}
			</span>
		) : null;

	const buttons = (
		<>
			{original ? (
				<Button
					variant="destructive-ghost"
					size={sheet ? "md" : "sm"}
					className={cn(!sheet && "-ml-2", sheet && "sm:mr-auto")}
					onClick={clear}
				>
					{t("blueprint.board.clear")}
				</Button>
			) : null}
			{sheet ? null : (
				<span className="ml-auto hidden text-ink-muted text-tiny md:inline">
					{t(multiline ? "blueprint.board.saveHintMultiline" : "blueprint.board.saveHint")}
				</span>
			)}
			<Button variant="ghost" size={sheet ? "md" : "sm"} onClick={onDone}>
				{t("common.cancel")}
			</Button>
			<Button type="submit" size={sheet ? "md" : "sm"}>
				{t("common.save")}
			</Button>
		</>
	);

	const suggest = (
		<SlotSuggest habit={habit} field={slot.field} onPick={setDraft} label={concept} />
	);

	return (
		<form
			ref={formRef}
			className={cn(sheet && "flex min-h-0 flex-1 flex-col")}
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				save();
			}}
		>
			{sheet ? (
				<>
					<DialogHeader title={concept} description={false} />
					<DialogBody className="pt-1">
						<div className="flex min-h-8 items-center justify-between gap-2">
							<p className="font-medium text-ink-muted text-tiny uppercase tracking-[0.08em]">
								{t("blueprint.board.lawHeading", heading)}
							</p>
							{suggest}
						</div>
						{/* Also the dialog's description, so it is read when the sheet opens. */}
						<DialogDescription className="mt-1 text-ink-muted text-small">{hint}</DialogDescription>
						<label htmlFor={inputId} className="sr-only">
							{concept}
						</label>
						<div className="mt-3">{control}</div>
						{counter ? <div className="mt-1.5 flex justify-end">{counter}</div> : null}
					</DialogBody>
					<DialogFooter>{buttons}</DialogFooter>
				</>
			) : (
				<>
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0">
							<p className="font-medium text-ink-muted text-tiny uppercase tracking-[0.08em]">
								{t("blueprint.board.lawHeading", heading)}
							</p>
							<label
								id={titleId}
								htmlFor={inputId}
								className="mt-0.5 block font-semibold text-ink leading-snug"
							>
								{concept}
							</label>
						</div>
						{suggest}
					</div>
					<p id={hintId} className="mt-1 text-ink-muted text-small">
						{hint}
					</p>
					<div className="mt-3">{control}</div>
					{counter ? <div className="mt-1 flex justify-end">{counter}</div> : null}
					<div className="mt-3 flex flex-wrap items-center justify-end gap-2">{buttons}</div>
				</>
			)}
		</form>
	);
}

/** The habit's values for the fields a slot edit touches, for Undo. */
function previousValues(habit: Habit, field: BlueprintField): HabitPatch {
	const touched = Object.keys(blueprintPatch(habit, field, null)) as (keyof HabitPatch)[];
	const before: Record<string, unknown> = {};
	for (const key of touched) before[key] = habit[key as keyof Habit] ?? null;
	return before as HabitPatch;
}

/**
 * The slot's AI suggestion (spec §5.3 table; T5's `AiSuggest`, nothing
 * without an account or the feature). A pick fills the field; Save keeps it.
 */
function SlotSuggest({
	habit,
	field,
	label,
	onPick,
}: {
	habit: Habit;
	field: BlueprintField;
	label: string;
	onPick(value: string): void;
}) {
	const text = useText();
	const identity = useIdentity(habit.identityId);
	const name = text.habit(habit, "name");
	const kind = habit.kind;
	if (kind === "build" && (field === "cueTime" || field === "cueLocation")) {
		return (
			<AiSuggest
				kind="habit.intention"
				label={label}
				input={() => ({
					habit: name,
					kind,
					timeOfDay: habit.timeOfDay === "anytime" ? undefined : habit.timeOfDay,
				})}
				onPick={(pick) => {
					const value = field === "cueTime" ? pick.time : pick.location;
					if (value) onPick(value);
				}}
			/>
		);
	}
	if (kind === "build" && field === "stackAfter") {
		return (
			<AiSuggest kind="habit.stack" label={label} input={() => ({ habit: name })} onPick={onPick} />
		);
	}
	if (kind === "build" && field === "twoMinute") {
		return (
			<AiSuggest
				kind="habit.twoMinute"
				label={label}
				input={() => ({ habit: name, kind })}
				onPick={onPick}
			/>
		);
	}
	const law =
		field === "environment"
			? "obvious"
			: field === "bundle"
				? "attractive"
				: field === "twoMinute"
					? "easy"
					: field === "reward"
						? "satisfying"
						: null;
	if (!law) return null;
	return (
		<AiSuggest
			kind="habit.laws"
			label={label}
			input={() => ({
				habit: name,
				kind,
				identity: identity ? text.identity(identity, "statement") : undefined,
			})}
			onPick={(pick) => onPick(pick[law])}
		/>
	);
}
