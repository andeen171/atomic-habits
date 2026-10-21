import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { useIsMobile } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import {
	type BlueprintField,
	type BlueprintLaw,
	type BlueprintSlot,
	type Habit,
	SETUP_FIELDS,
	type SetupField,
	blueprintSlots,
	lawHeading,
	lawPrinciple,
	setupFieldsFor,
	slotTitle,
	weakestLaw,
} from "@atomic/core";
import { type TextApi, useIdentity, useText } from "@atomic/core/react";
import { Link } from "@tanstack/react-router";
import { Check, PenLine, Pencil, Plus } from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import { PrincipleQuote } from "../principles/principle-quote";
import { Button } from "../ui/button";
import { BlueprintSlotDialog, BlueprintSlotPopover } from "./blueprint-slot-editor";
import { SetupTaskAction } from "./setup-task-action";

export interface BlueprintBoardProps {
	habit: Habit;
	className?: string;
}

const LAWS: readonly BlueprintLaw[] = [1, 2, 3, 4];

/**
 * The habit's blueprint as a board (item 5; spec §5.3, D14, Annex H §1.3):
 * four law columns headed "law · stage" (the inverse laws for break habits).
 * A filled slot shows the user's words with the book's concept under them;
 * an empty slot shows the concept itself. Slots are edited in place (a
 * popover from md up, a sheet on phones). The header counts the slots in
 * place, offers "Fill next" and "Edit all", and quotes the principle of the
 * weakest law. Below md the laws stack with sticky headers.
 */
export function BlueprintBoard({ habit, className }: BlueprintBoardProps) {
	const { t } = useT();
	const text = useText();
	const identity = useIdentity(habit.identityId);
	const mobile = useIsMobile();
	const style = useHabitStyle(habit.color);
	const titleId = useId();
	const baseId = useId();
	const [editing, setEditing] = useState<BlueprintField | null>(null);
	/** The sheet keeps its last slot while it animates out. */
	const [sheetField, setSheetField] = useState<BlueprintField | null>(null);
	const tiles = useRef(new Map<BlueprintField, HTMLButtonElement>());

	const slots = blueprintSlots(habit);
	const filled = slots.filter((slot) => slot.value !== null).length;
	const total = slots.length;
	const next = slots.find((slot) => slot.value === null);
	const complete = filled === total;
	const convertible = new Set<SetupField>(setupFieldsFor(habit.kind).map((spec) => spec.field));
	const sheetSlot = slots.find((slot) => slot.field === sheetField);

	const open = (field: BlueprintField) => {
		setSheetField(field);
		setEditing(field);
	};

	const renderTile = (slot: BlueprintSlot, lawId: string) => {
		const value = slot.value ? displayValue(habit, slot, text) : null;
		const title = slotTitle({ ...slot, value }, t);
		const concept = t(slot.concept);
		const isFilled = value !== null;
		const setup =
			isFilled && (SETUP_FIELDS as readonly string[]).includes(slot.field)
				? convertible.has(slot.field as SetupField)
				: false;
		const tile = (
			<button
				type="button"
				ref={(el) => {
					if (el) tiles.current.set(slot.field, el);
					else tiles.current.delete(slot.field);
				}}
				aria-label={
					isFilled
						? `${t("blueprint.board.editField", { concept })}: ${title}`
						: t("blueprint.board.add", { concept })
				}
				aria-describedby={lawId}
				onClick={mobile ? () => open(slot.field) : undefined}
				className={cn(
					"group/slot flex min-h-[3.75rem] w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-[border-color,background-color,box-shadow] duration-(--atomic-duration-fast)",
					isFilled
						? "border-line bg-surface hover:border-line-strong hover:bg-hover/50 data-[state=open]:border-accent/50"
						: "border-line-strong border-dashed bg-sunken/45 hover:border-accent/45 hover:bg-accent-soft/30 data-[state=open]:border-accent/60",
					setup && "pr-11",
				)}
			>
				{isFilled ? null : (
					<span
						aria-hidden="true"
						className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-surface text-ink-muted ring-1 ring-line-strong transition-colors group-hover/slot:text-ink"
					>
						<Plus className="size-3.5" />
					</span>
				)}
				<span className="min-w-0 flex-1">
					<span
						className={cn(
							"block break-words text-small leading-snug",
							isFilled ? "font-medium text-ink" : "font-medium text-ink-muted",
						)}
					>
						{title}
					</span>
					<span className="mt-0.5 block break-words text-ink-muted text-tiny leading-snug">
						{isFilled ? concept : t(slot.hint)}
					</span>
				</span>
				{isFilled && !setup ? (
					<Pencil
						aria-hidden="true"
						className="mt-0.5 size-3.5 shrink-0 text-ink-subtle opacity-0 transition-opacity group-hover/slot:opacity-100 group-focus-visible/slot:opacity-100 [@media(hover:none)]:hidden"
					/>
				) : null}
			</button>
		);
		return (
			<li key={slot.field} className="relative">
				{mobile ? (
					tile
				) : (
					<BlueprintSlotPopover
						habit={habit}
						slot={slot}
						open={editing === slot.field}
						onOpenChange={(isOpen) => setEditing(isOpen ? slot.field : null)}
					>
						{tile}
					</BlueprintSlotPopover>
				)}
				{setup ? (
					<div className="absolute top-2 right-2 empty:hidden">
						<SetupTaskAction habit={habit} field={slot.field as SetupField} compact />
					</div>
				) : null}
			</li>
		);
	};

	return (
		<section
			aria-labelledby={titleId}
			style={style}
			className={cn("rounded-xl border border-line bg-surface shadow-card", className)}
		>
			<div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pt-5 md:px-6 md:pt-6">
				<div className="min-w-0">
					<h2 id={titleId} className="font-semibold text-h3 text-ink">
						{t("detail.blueprint")}
					</h2>
					<div className="mt-1.5 flex items-center gap-2.5">
						<Meter filled={filled} total={total} />
						<p className="text-ink-muted text-small tabular-nums">
							{t("blueprint.board.filled", { count: filled, total })}
						</p>
					</div>
				</div>
				<div className="flex items-center gap-1.5">
					{next ? (
						<Button variant="soft" size="sm" onClick={() => open(next.field)}>
							<PenLine />
							{t("blueprint.board.fillNext")}
						</Button>
					) : null}
					<Button asChild variant="ghost" size="sm">
						<Link to="/habits/$habitId/edit" params={{ habitId: habit.id }}>
							{t("blueprint.board.editAll")}
						</Link>
					</Button>
				</div>
			</div>

			{complete ? (
				<p className="mx-5 mt-3 flex items-start gap-2 text-ink text-small md:mx-6">
					<Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
					{t("blueprint.board.complete")}
				</p>
			) : null}
			<PrincipleQuote
				id={lawPrinciple(weakestLaw(habit), habit.kind)}
				variant="inline"
				className="mx-5 mt-4 md:mx-6"
			/>

			<div className="grid grid-cols-1 gap-x-4 gap-y-2 px-5 pt-3 pb-5 md:grid-cols-2 md:gap-y-6 md:px-6 md:pt-5 md:pb-6 lg:grid-cols-4">
				{LAWS.map((law) => {
					const lawSlots = slots.filter((slot) => slot.law === law);
					if (!lawSlots.length) return null;
					const lawId = `${baseId}-law-${law}`;
					const heading = lawHeading(law, habit.kind, t);
					const lawFilled = lawSlots.filter((slot) => slot.value !== null).length;
					return (
						<section key={law} aria-labelledby={lawId} className="min-w-0">
							<h3
								id={lawId}
								className="-mx-5 sticky top-0 z-10 flex items-center gap-2 border-line/70 border-b bg-surface px-5 py-2.5 md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0"
							>
								<LawBadge law={law} filled={lawFilled} total={lawSlots.length} />
								<span className="min-w-0 text-small leading-snug">
									<span className="font-semibold text-ink">{heading.name}</span>
									<span className="text-ink-muted"> · {heading.stage}</span>
								</span>
							</h3>
							<ul className="mt-2.5 flex flex-col gap-2">
								{lawSlots.map((slot) => renderTile(slot, lawId))}
							</ul>
						</section>
					);
				})}
			</div>

			{identity && !identity.deletedAt ? (
				<IdentityFooter>
					<Link
						to="/identity"
						className="group inline-flex items-start gap-2.5 rounded-xs text-ink-muted hover:text-ink"
					>
						<span aria-hidden="true" className="font-emoji text-lg leading-7">
							{identity.emoji}
						</span>
						<span className="font-display text-[1.375rem] italic leading-7 underline-offset-4 group-hover:underline">
							{t("blueprint.identity", { identity: text.identity(identity, "statement") })}
						</span>
					</Link>
				</IdentityFooter>
			) : null}

			{mobile && sheetSlot ? (
				<BlueprintSlotDialog
					key={sheetSlot.field}
					habit={habit}
					slot={sheetSlot}
					open={editing === sheetSlot.field}
					onOpenChange={(isOpen) => setEditing(isOpen ? sheetSlot.field : null)}
					returnFocus={() => tiles.current.get(sheetSlot.field) ?? null}
				/>
			) : null}
		</section>
	);
}

function IdentityFooter({ children }: { children: ReactNode }) {
	return <div className="border-line border-t px-5 py-4 md:px-6">{children}</div>;
}

/** The slot's words in the content language (D32); edits always change the original. */
function displayValue(habit: Habit, slot: BlueprintSlot, text: TextApi): string | null {
	if (slot.field === "cueTime") return slot.value;
	if (habit.kind === "break" && slot.field === "cueLocation") {
		return habit.cueLocation?.trim()
			? text.habit(habit, "cueLocation")
			: text.habit(habit, "stackAfter");
	}
	return text.habit(habit, slot.field);
}

/** The law's number, filled in the habit's colour once every slot of the law is in place. */
function LawBadge({ law, filled, total }: { law: BlueprintLaw; filled: number; total: number }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"grid size-6 shrink-0 place-items-center rounded-full font-semibold text-[11px] tabular-nums",
				filled === total
					? "bg-(--habit) text-(--habit-on-text)"
					: filled > 0
						? "bg-(--habit-soft) text-ink"
						: "bg-sunken text-ink-muted ring-1 ring-line",
			)}
		>
			{law}
		</span>
	);
}

/** One segment per slot, in the habit's colour as slots fill (the count is the text next to it). */
function Meter({ filled, total }: { filled: number; total: number }) {
	return (
		<span aria-hidden="true" className="flex gap-0.5">
			{Array.from({ length: total }, (_, i) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length decorative segments.
					key={i}
					className={cn(
						"h-1.5 w-3 rounded-full transition-colors duration-(--atomic-duration-base)",
						i < filled ? "bg-(--habit)" : "bg-heat-0",
					)}
				/>
			))}
		</span>
	);
}
