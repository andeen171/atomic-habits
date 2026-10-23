import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import {
	JOURNAL_KINDS,
	JOURNAL_KIND_SPECS,
	type JournalKind,
	type JournalTimelineKind,
	journalKindKey,
	journalLinkLabel,
} from "@atomic/core";
import { useAllHabits, useAtomic, useIdentities, useText } from "@atomic/core/react";
import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Link2, NotebookText, Search, UserRound, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Chip } from "../ui/chip";
import { Input } from "../ui/field";
import { IconButton } from "../ui/icon-button";
import { MenuContent, MenuSeparator } from "../ui/menu";
import { JOURNAL_KIND_ICONS } from "./kind-icon";

/** The Journal's filters, as they live in the URL (Annex J §4). */
export interface JournalFilterState {
	/** An identity id, or "none". */
	identity?: string;
	habit?: string;
	/** Selected kinds and "dayNote"; empty: everything. */
	kinds: readonly JournalTimelineKind[];
	q?: string;
}

export type JournalFilterPatch = Partial<Omit<JournalFilterState, "kinds">> & {
	kinds?: readonly JournalTimelineKind[];
};

/** Chip order: the picker's (Quick, Plan, Reflect, Free), then day notes. */
const KIND_CHIPS: readonly JournalTimelineKind[] = [
	...(["quick", "plan", "reflect", "free"] as const).flatMap((group) =>
		JOURNAL_KINDS.filter((kind) => JOURNAL_KIND_SPECS[kind].group === group),
	),
	"dayNote",
];

export function hasActiveFilters(state: JournalFilterState): boolean {
	return !!(state.identity || state.habit || state.kinds.length || state.q);
}

/** The search box's id, to put focus back in it after "Clear filters". */
export const JOURNAL_SEARCH_ID = "journal-search";

/** How long typing waits before the search reaches the URL (Annex J §4). */
const SEARCH_DEBOUNCE_MS = 150;

interface JournalFiltersProps {
	value: JournalFilterState;
	onChange(patch: JournalFilterPatch): void;
	/** Shown (and announced) while any filter is on. */
	resultCount: number;
	onClear(): void;
}

/**
 * The Journal's toolbar (Annex J §4): search (debounced into `q`), identity
 * and habit menus, multi-select kind chips plus "Day notes" (`aria-pressed`,
 * a scrolling row on phones), and "Clear filters" with the result count
 * (a polite live region) while any filter is on.
 */
export function JournalFilters({ value, onChange, resultCount, onClear }: JournalFiltersProps) {
	const { t } = useT();
	const active = hasActiveFilters(value);
	const selected = new Set(value.kinds);

	const toggleKind = (kind: JournalTimelineKind) => {
		const next = selected.has(kind)
			? value.kinds.filter((item) => item !== kind)
			: KIND_CHIPS.filter((item) => item === kind || selected.has(item));
		onChange({ kinds: next });
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
				<SearchField value={value.q ?? ""} onChange={(q) => onChange({ q: q || undefined })} />
				<div className="flex min-w-0 flex-wrap gap-2">
					<IdentityMenu value={value.identity} onChange={(identity) => onChange({ identity })} />
					<HabitMenu value={value.habit} onChange={(habit) => onChange({ habit })} />
				</div>
			</div>

			<div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-4">
				<fieldset className="-mx-5 m-0 flex min-w-0 gap-1.5 overflow-x-auto border-0 px-5 pt-0 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden">
					<legend className="sr-only">{t("journal.filter.kinds")}</legend>
					{KIND_CHIPS.map((kind) => {
						const Icon =
							kind === "dayNote"
								? NotebookText
								: JOURNAL_KIND_ICONS[JOURNAL_KIND_SPECS[kind as JournalKind].icon];
						return (
							<Chip key={kind} selected={selected.has(kind)} onClick={() => toggleKind(kind)}>
								<Icon aria-hidden="true" />
								{kind === "dayNote" ? t("journal.filter.dayNotes") : t(journalKindKey(kind))}
							</Chip>
						);
					})}
				</fieldset>
				<span aria-live="polite" className="sr-only">
					{active ? t.tp("journal.results", resultCount) : ""}
				</span>
				{/* Reserved on wide screens, so the chips don't reflow when a filter turns on. */}
				<div
					className={cn(
						"flex shrink-0 items-center gap-3 text-small md:min-h-8",
						!active && "hidden md:invisible md:flex",
					)}
				>
					<span aria-hidden="true" className="text-ink-muted tabular-nums">
						{t.tp("journal.results", resultCount)}
					</span>
					<button
						type="button"
						onClick={onClear}
						tabIndex={active ? undefined : -1}
						className="rounded-sm font-medium text-accent-text underline-offset-4 hover:underline"
					>
						{t("journal.filter.clear")}
					</button>
				</div>
			</div>
		</div>
	);
}

/** The search box: local while typing, written to the URL after a short pause; Esc clears it. */
function SearchField({ value, onChange }: { value: string; onChange(value: string): void }) {
	const { t } = useT();
	const [draft, setDraft] = useState(value);
	const inputRef = useRef<HTMLInputElement>(null);
	const sent = useRef(value);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	// The URL changed elsewhere (Clear filters, Back): follow it.
	useEffect(() => {
		if (value !== sent.current) {
			sent.current = value;
			setDraft(value);
		}
	}, [value]);

	useEffect(() => {
		const next = draft.trim();
		if (next === sent.current.trim()) return;
		const timer = window.setTimeout(() => {
			sent.current = next;
			onChangeRef.current(next);
		}, SEARCH_DEBOUNCE_MS);
		return () => window.clearTimeout(timer);
	}, [draft]);

	const clear = () => {
		setDraft("");
		sent.current = "";
		onChangeRef.current("");
		inputRef.current?.focus();
	};

	return (
		<div className="relative min-w-0 flex-1">
			<Search
				aria-hidden="true"
				className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3.5 size-[18px] text-ink-subtle"
			/>
			<Input
				ref={inputRef}
				id={JOURNAL_SEARCH_ID}
				type="search"
				value={draft}
				maxLength={120}
				aria-label={t("journal.search")}
				placeholder={t("journal.search")}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape" && draft) {
						event.preventDefault();
						event.stopPropagation();
						clear();
					}
				}}
				className="pr-11 pl-10 [&::-webkit-search-cancel-button]:hidden"
			/>
			{draft ? (
				<IconButton
					label={t("journal.clearSearch")}
					size="sm"
					onClick={clear}
					className="-translate-y-1/2 absolute top-1/2 right-1.5"
				>
					<X />
				</IconButton>
			) : null}
		</div>
	);
}

function RadioItem({
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
			className="flex min-h-9 cursor-pointer select-none items-center gap-2.5 rounded-sm py-1.5 pr-3 pl-2.5 text-ink text-small outline-none transition-colors data-[highlighted]:bg-hover"
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

/** A filter menu's trigger: a pill that reads as selected while it filters. */
function FilterTrigger({
	label,
	value,
	icon,
	active,
}: {
	label: string;
	value: string;
	icon: ReactNode;
	active: boolean;
}) {
	return (
		<MenuPrimitive.Trigger asChild>
			<button
				type="button"
				aria-label={`${label}: ${value}`}
				className={cn(
					"inline-flex h-11 min-w-0 max-w-full items-center gap-2 rounded-full border px-4 font-medium text-small transition-colors duration-(--atomic-duration-fast) sm:max-w-64 [&_svg]:size-4 [&_svg]:shrink-0",
					active
						? "border-ink bg-ink text-bg"
						: "border-line bg-surface text-ink-muted shadow-card hover:border-line-strong hover:text-ink",
				)}
			>
				{icon}
				<span className="min-w-0 truncate">{value}</span>
				<ChevronDown aria-hidden="true" className={active ? "text-bg/70" : "text-ink-subtle"} />
			</button>
		</MenuPrimitive.Trigger>
	);
}

function IdentityMenu({
	value,
	onChange,
}: { value: string | undefined; onChange(value: string | undefined): void }) {
	const { t } = useT();
	const text = useText();
	const identities = useIdentities();
	const records = useAtomic((s) => s.data.identities);
	const labelId = useId();
	const current = value && value !== "none" ? records[value] : undefined;
	const link = value && value !== "none" ? journalLinkLabel("identity", value, records, t) : null;
	const label =
		value === "none"
			? t("journal.filter.noIdentity")
			: current && !current.deletedAt
				? text.identity(current, "statement")
				: (link?.text ?? t("journal.filter.allIdentities"));
	return (
		<MenuPrimitive.Root modal={false}>
			<span id={labelId} className="sr-only">
				{t("journal.link.identity")}
			</span>
			<FilterTrigger
				label={t("journal.link.identity")}
				value={label}
				active={!!value}
				icon={
					current && !current.deletedAt ? (
						<span aria-hidden="true" className="font-emoji text-[15px] leading-none">
							{current.emoji}
						</span>
					) : (
						<UserRound aria-hidden="true" />
					)
				}
			/>
			<MenuContent align="start" className="max-h-80 min-w-60 overflow-y-auto">
				<MenuPrimitive.RadioGroup value={value ?? ""} aria-labelledby={labelId}>
					<RadioItem value="" onSelect={() => onChange(undefined)}>
						{t("journal.filter.allIdentities")}
					</RadioItem>
					{identities.length ? <MenuSeparator /> : null}
					{identities.map((identity) => (
						<RadioItem key={identity.id} value={identity.id} onSelect={() => onChange(identity.id)}>
							<span aria-hidden="true" className="w-4 text-center font-emoji text-[14px]">
								{identity.emoji}
							</span>
							<span className="min-w-0 break-words">{text.identity(identity, "statement")}</span>
						</RadioItem>
					))}
					{value && value !== "none" && !(current && !current.deletedAt) ? (
						<RadioItem value={value} onSelect={() => onChange(value)}>
							<span className="text-ink-muted italic">{label}</span>
						</RadioItem>
					) : null}
					<MenuSeparator />
					<RadioItem value="none" onSelect={() => onChange("none")}>
						{t("journal.filter.noIdentity")}
					</RadioItem>
				</MenuPrimitive.RadioGroup>
			</MenuContent>
		</MenuPrimitive.Root>
	);
}

function HabitMenu({
	value,
	onChange,
}: { value: string | undefined; onChange(value: string | undefined): void }) {
	const { t } = useT();
	const text = useText();
	const habits = useAllHabits();
	const records = useAtomic((s) => s.data.habits);
	const labelId = useId();
	const current = value ? records[value] : undefined;
	const live = current && !current.deletedAt ? current : undefined;
	const link = value ? journalLinkLabel("habit", value, records, t) : null;
	const label = live ? text.habit(live, "name") : (link?.text ?? t("journal.filter.allHabits"));
	const active = habits.filter((habit) => !habit.archivedAt);
	const archived = habits.filter((habit) => habit.archivedAt);
	return (
		<MenuPrimitive.Root modal={false}>
			<span id={labelId} className="sr-only">
				{t("journal.link.habit")}
			</span>
			<FilterTrigger
				label={t("journal.link.habit")}
				value={label}
				active={!!value}
				icon={
					live ? (
						<span aria-hidden="true" className="font-emoji text-[15px] leading-none">
							{live.emoji}
						</span>
					) : (
						<Link2 aria-hidden="true" />
					)
				}
			/>
			<MenuContent align="start" className="max-h-80 min-w-60 overflow-y-auto">
				<MenuPrimitive.RadioGroup value={value ?? ""} aria-labelledby={labelId}>
					<RadioItem value="" onSelect={() => onChange(undefined)}>
						{t("journal.filter.allHabits")}
					</RadioItem>
					{active.length ? <MenuSeparator /> : null}
					{active.map((habit) => (
						<RadioItem key={habit.id} value={habit.id} onSelect={() => onChange(habit.id)}>
							<span aria-hidden="true" className="w-4 text-center font-emoji text-[14px]">
								{habit.emoji}
							</span>
							<span className="min-w-0 break-words">{text.habit(habit, "name")}</span>
						</RadioItem>
					))}
					{archived.length ? (
						<>
							<MenuSeparator />
							<MenuPrimitive.Label className="px-2.5 pt-1 pb-1.5 font-semibold text-ink-subtle text-tiny uppercase tracking-[0.08em]">
								{t("habits.filter.archived")}
							</MenuPrimitive.Label>
							{archived.map((habit) => (
								<RadioItem key={habit.id} value={habit.id} onSelect={() => onChange(habit.id)}>
									<span aria-hidden="true" className="w-4 text-center font-emoji text-[14px]">
										{habit.emoji}
									</span>
									<span className="min-w-0 break-words">{text.habit(habit, "name")}</span>
								</RadioItem>
							))}
						</>
					) : null}
					{value && !live ? (
						<RadioItem value={value} onSelect={() => onChange(value)}>
							<span className="text-ink-muted italic">{label}</span>
						</RadioItem>
					) : null}
				</MenuPrimitive.RadioGroup>
			</MenuContent>
		</MenuPrimitive.Root>
	);
}
