import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { useHabit, useHabits, useText } from "@atomic/core/react";
import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Link2 } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Chip } from "../ui/chip";
import { MenuContent, MenuSeparator } from "../ui/menu";

interface HabitLinkFieldProps {
	/** The linked habit's id, or null. */
	value: string | null;
	onChange(habitId: string | null): void;
	disabled?: boolean;
}

/**
 * Which habit a task helps form (Annex T §4.3): "Not linked" or one of the
 * live, non-archived habits. A link to an archived habit (a paused setup
 * task) stays listed so the current choice is always visible.
 */
export function HabitLinkField({ value, onChange, disabled }: HabitLinkFieldProps) {
	const { t } = useT();
	const text = useText();
	const labelId = useId();
	const habits = useHabits();
	const current = useHabit(value ?? undefined);
	const options = current && !habits.includes(current) ? [current, ...habits] : habits;
	const name = current ? text.habit(current, "name") : null;

	return (
		<div className="flex flex-col gap-1.5">
			<span id={labelId} className="font-medium text-ink text-small">
				{t("tasks.habit")}
			</span>
			<div>
				<MenuPrimitive.Root modal={false}>
					<MenuPrimitive.Trigger asChild>
						<Chip
							selected={false}
							disabled={disabled}
							aria-label={`${t("tasks.habit")}: ${name ?? t("tasks.habitNone")}`}
							className="h-auto min-h-8 max-w-full whitespace-normal py-1 text-left"
						>
							{current ? (
								<span aria-hidden="true" className="font-emoji text-[14px] leading-none">
									{current.emoji}
								</span>
							) : (
								<Link2 aria-hidden="true" />
							)}
							<span className={cn("min-w-0 break-words", current && "text-ink")}>
								{name ?? t("tasks.habitNone")}
							</span>
							<ChevronDown aria-hidden="true" className="-mr-0.5 text-ink-subtle" />
						</Chip>
					</MenuPrimitive.Trigger>
					<MenuContent align="start" className="max-h-80 min-w-56 overflow-y-auto">
						<MenuPrimitive.RadioGroup value={value ?? ""} aria-labelledby={labelId}>
							<LinkItem value="" onSelect={() => onChange(null)}>
								<Link2 aria-hidden="true" className="size-4 text-ink-subtle" />
								{t("tasks.habitNone")}
							</LinkItem>
							{options.length ? <MenuSeparator /> : null}
							{options.map((habit) => (
								<LinkItem key={habit.id} value={habit.id} onSelect={() => onChange(habit.id)}>
									<span aria-hidden="true" className="w-4 text-center font-emoji text-[14px]">
										{habit.emoji}
									</span>
									<span className="min-w-0 truncate">{text.habit(habit, "name")}</span>
								</LinkItem>
							))}
						</MenuPrimitive.RadioGroup>
					</MenuContent>
				</MenuPrimitive.Root>
			</div>
		</div>
	);
}

function LinkItem({
	value,
	onSelect,
	children,
}: {
	value: string;
	onSelect(): void;
	children: ReactNode;
}) {
	return (
		<MenuPrimitive.RadioItem
			value={value}
			onSelect={onSelect}
			className="flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-sm pr-3 pl-2.5 text-ink text-small outline-none transition-colors data-[highlighted]:bg-hover"
		>
			{children}
			<span className="ml-auto grid size-4 shrink-0 place-items-center pl-2 text-accent-text">
				<MenuPrimitive.ItemIndicator>
					<Check className="size-4" strokeWidth={2.5} />
				</MenuPrimitive.ItemIndicator>
			</span>
		</MenuPrimitive.RadioItem>
	);
}
