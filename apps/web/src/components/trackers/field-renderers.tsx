import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import {
	type AttachmentRef,
	CURRENCIES,
	type DayKey,
	type FieldSpec,
	type FormValue,
	type ShelfBook,
	isCurrencyCode,
	moneyInputValue,
	parseClockInput,
	parseDecimalInput,
	parseDurationInput,
} from "@atomic/core";
import { ImageOff, Plus } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";
import { Combobox } from "../ui/combobox";
import { controlClass } from "../ui/control";
import { Textarea } from "../ui/field";
import { trackerCaps } from "./caps";
import { PhotoPicker } from "./photo-field";

/**
 * One renderer per composer `FieldSpec` kind (Annex K §3.4, §4.1). Core
 * describes the fields and parses every value (`formToData`), so these only
 * collect text: money, numbers, durations and clock times stay as typed until
 * the composer saves. Owner: T4.
 */

export interface FieldRendererProps {
	spec: FieldSpec;
	value: FormValue | undefined;
	onChange(value: FormValue): void;
	/** Translated `formToData` error for this field. */
	error?: string;
	/** Books for the `book` field (`useBooks`). */
	books?: readonly ShelfBook[];
	/** "+ New book" from the `book` field. */
	onNewBook?(): void;
	/** Read-only (archived habit). */
	disabled?: boolean;
	/** Large and centred: the one number the entry is about (a number log's value). */
	hero?: boolean;
	/** Takes focus when the composer opens (instead of the first field). */
	autoFocus?: boolean;
	/** The entry's day (photo alt text). */
	day?: DayKey;
	/** Photos are being prepared: the composer holds Save until they're in. */
	onBusyChange?(busy: boolean): void;
}

export function FieldRenderer(props: FieldRendererProps) {
	const { spec } = props;
	switch (spec.kind) {
		case "money":
			return <MoneyField {...props} spec={spec} />;
		case "number":
			return <NumberInput {...props} spec={spec} />;
		case "duration":
			return <DurationField {...props} spec={spec} />;
		case "clock":
			return <ClockField {...props} spec={spec} />;
		case "choice":
			return <ChoiceField {...props} spec={spec} />;
		case "text":
			return <TextField {...props} spec={spec} />;
		case "longtext":
			return <LongTextField {...props} spec={spec} />;
		case "rating":
			return <RatingField {...props} spec={spec} />;
		case "book":
			return <BookField {...props} spec={spec} />;
		case "lines":
			return <LinesField {...props} spec={spec} />;
		case "day":
			return <DayField {...props} spec={spec} />;
		case "photos":
			return <PhotosField {...props} spec={spec} />;
	}
}

type SpecOf<K extends FieldSpec["kind"]> = Extract<FieldSpec, { kind: K }>;
type KindProps<K extends FieldSpec["kind"]> = Omit<FieldRendererProps, "spec"> & {
	spec: SpecOf<K>;
};

const asText = (value: FormValue | undefined): string =>
	typeof value === "string" ? value : typeof value === "number" ? String(value) : "";

/** Label, control, then the error (or hint). Group controls label a fieldset instead. */
function FieldShell({
	spec,
	error,
	group,
	children,
	labelExtra,
	className,
}: {
	spec: FieldSpec;
	error?: string;
	/** Radio groups and chip rows: a fieldset with a legend. */
	group?: boolean;
	labelExtra?: ReactNode;
	className?: string;
	children(ids: {
		id: string;
		labelId: string;
		describedBy: string | undefined;
		invalid: true | undefined;
	}): ReactNode;
}) {
	const { t } = useT();
	const id = useId();
	const labelId = `${id}-label`;
	const noteId = `${id}-note`;
	const note = error ?? spec.hint;
	const ids = {
		id,
		labelId,
		describedBy: note ? noteId : undefined,
		invalid: error ? (true as const) : undefined,
	};
	const optional = spec.required ? null : (
		<span className="font-normal text-ink-subtle text-tiny">{t("common.optional")}</span>
	);
	const label = (
		<span className="flex min-w-0 items-baseline justify-between gap-2">
			<span className="min-w-0 break-words">
				{spec.label}
				{labelExtra}
			</span>
			{optional}
		</span>
	);
	const footer = note ? (
		<p
			id={noteId}
			role={error ? "alert" : undefined}
			className={cn("text-small", error ? "text-danger" : "text-ink-subtle")}
		>
			{note}
		</p>
	) : null;
	if (group) {
		return (
			<fieldset className={cn("flex min-w-0 flex-col gap-2", className)}>
				<legend id={labelId} className="mb-2 w-full font-medium text-ink text-small">
					{label}
				</legend>
				{children(ids)}
				{footer}
			</fieldset>
		);
	}
	return (
		<div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
			<label id={labelId} htmlFor={id} className="font-medium text-ink text-small">
				{label}
			</label>
			{children(ids)}
			{footer}
		</div>
	);
}

// ── Money ─────────────────────────────────────────────────────────────────

function MoneyField({ spec, value, onChange, error, disabled }: KindProps<"money">) {
	const { t } = useT();
	const name = isCurrencyCode(spec.currency)
		? CURRENCIES[spec.currency].name[t.locale]
		: spec.currency;
	const placeholder = moneyInputValue(0, spec.currency, t.locale);
	if (spec.hero) {
		return (
			<FieldShell spec={spec} error={error} labelExtra={<span className="sr-only"> ({name})</span>}>
				{(ids) => (
					<div
						className={cn(
							"flex h-20 items-center justify-center gap-2 rounded-xl border border-line bg-sunken/60 px-4 transition-[border-color,box-shadow,background-color] duration-(--atomic-duration-fast)",
							"focus-within:border-accent focus-within:bg-surface focus-within:ring-3 focus-within:ring-accent/15",
							ids.invalid && "border-danger",
						)}
					>
						<span
							aria-hidden="true"
							className="shrink-0 font-display text-[1.75rem] text-ink-muted"
						>
							{spec.symbol}
						</span>
						<input
							id={ids.id}
							data-autofocus=""
							type="text"
							inputMode="decimal"
							autoComplete="off"
							enterKeyHint="done"
							disabled={disabled}
							aria-describedby={ids.describedBy}
							aria-invalid={ids.invalid}
							placeholder={placeholder}
							value={asText(value)}
							onChange={(event) => onChange(event.target.value)}
							// Sized to its text, so the symbol stays next to the number as one centred group.
							style={{
								width: `${Math.max(asText(value).length, placeholder.length) + 0.5}ch`,
							}}
							className="min-w-[3ch] max-w-full bg-transparent text-center font-display text-[2.75rem] text-ink tabular-nums leading-none outline-none placeholder:text-ink-subtle/70"
						/>
					</div>
				)}
			</FieldShell>
		);
	}
	return (
		<FieldShell spec={spec} error={error} labelExtra={<span className="sr-only"> ({name})</span>}>
			{(ids) => (
				<div
					className={cn(
						controlClass,
						"flex h-11 items-center gap-2 focus-within:border-accent focus-within:bg-surface focus-within:ring-3 focus-within:ring-accent/15",
						ids.invalid && "border-danger",
					)}
				>
					<span aria-hidden="true" className="shrink-0 text-ink-muted">
						{spec.symbol}
					</span>
					<input
						id={ids.id}
						type="text"
						inputMode="decimal"
						autoComplete="off"
						disabled={disabled}
						aria-describedby={ids.describedBy}
						aria-invalid={ids.invalid}
						placeholder={placeholder}
						value={asText(value)}
						onChange={(event) => onChange(event.target.value)}
						className="h-full min-w-0 flex-1 bg-transparent tabular-nums outline-none"
					/>
				</div>
			)}
		</FieldShell>
	);
}

// ── Numbers and durations ─────────────────────────────────────────────────

/** A number as typed in the locale ("12,5"), without grouping. */
function plain(n: number, locale: string): string {
	const text = String(Math.round(n * 1000) / 1000);
	return locale === "pt-BR" ? text.replace(".", ",") : text;
}

function QuickChips({
	items,
	onPick,
	disabled,
}: {
	items: { key: string; label: string; ariaLabel?: string }[];
	onPick(key: string): void;
	disabled?: boolean;
}) {
	if (!items.length) return null;
	return (
		<div className="flex flex-wrap gap-1.5">
			{items.map((item) => (
				<button
					key={item.key}
					type="button"
					disabled={disabled}
					aria-label={item.ariaLabel}
					onClick={() => onPick(item.key)}
					className="inline-flex h-8 pointer-coarse:h-10 items-center rounded-full border border-line bg-surface px-3 font-medium text-ink-muted text-small tabular-nums transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
				>
					{item.label}
				</button>
			))}
		</div>
	);
}

function NumberInput({
	spec,
	value,
	onChange,
	error,
	disabled,
	hero,
	autoFocus,
}: KindProps<"number">) {
	const { t } = useT();
	const text = asText(value);
	const add = (amount: number) => {
		const current = parseDecimalInput(text) ?? 0;
		onChange(plain(Math.min(spec.max, Math.max(spec.min, current + amount)), t.locale));
	};
	if (hero) {
		const placeholder = spec.placeholder ?? "0";
		return (
			<FieldShell
				spec={spec}
				error={error}
				labelExtra={spec.unit ? <span className="sr-only"> ({spec.unit})</span> : null}
			>
				{(ids) => (
					<div
						className={cn(
							"flex h-20 items-center justify-center gap-2.5 rounded-xl border border-line bg-sunken/60 px-4 transition-[border-color,box-shadow,background-color] duration-(--atomic-duration-fast)",
							"focus-within:border-accent focus-within:bg-surface focus-within:ring-3 focus-within:ring-accent/15",
							ids.invalid && "border-danger",
						)}
					>
						<input
							id={ids.id}
							data-autofocus=""
							type="text"
							inputMode={spec.decimals > 0 ? "decimal" : "numeric"}
							autoComplete="off"
							enterKeyHint="done"
							disabled={disabled}
							aria-describedby={ids.describedBy}
							aria-invalid={ids.invalid}
							placeholder={placeholder}
							value={text}
							onChange={(event) => onChange(event.target.value)}
							// Sized to its text, so the unit stays beside the number as one centred group.
							style={{ width: `${Math.max(text.length, placeholder.length) + 0.5}ch` }}
							className="min-w-[2ch] max-w-full bg-transparent text-center font-display text-[2.75rem] text-ink tabular-nums leading-none outline-none placeholder:text-ink-subtle/70"
						/>
						{spec.unit ? (
							<span
								aria-hidden="true"
								className="min-w-0 shrink truncate pt-2 text-[1.125rem] text-ink-muted"
							>
								{spec.unit}
							</span>
						) : null}
					</div>
				)}
			</FieldShell>
		);
	}
	return (
		<FieldShell spec={spec} error={error}>
			{(ids) => (
				<div className="flex flex-col gap-2">
					<div
						className={cn(
							controlClass,
							"flex h-11 items-center gap-2 focus-within:border-accent focus-within:bg-surface focus-within:ring-3 focus-within:ring-accent/15",
							ids.invalid && "border-danger",
						)}
					>
						<input
							id={ids.id}
							data-autofocus={autoFocus ? "" : undefined}
							type="text"
							inputMode={spec.decimals > 0 ? "decimal" : "numeric"}
							autoComplete="off"
							disabled={disabled}
							aria-describedby={ids.describedBy}
							aria-invalid={ids.invalid}
							placeholder={spec.placeholder}
							value={text}
							onChange={(event) => onChange(event.target.value)}
							className="h-full min-w-0 flex-1 bg-transparent tabular-nums outline-none"
						/>
						{spec.unit ? (
							<span className="shrink-0 text-ink-muted text-small">{spec.unit}</span>
						) : null}
					</div>
					<QuickChips
						disabled={disabled}
						items={(spec.quick ?? []).map((amount) => ({
							key: String(amount),
							label: `+${t.number(amount)}`,
							ariaLabel: t("tracker.quickAdd", {
								amount: spec.unit ? `${t.number(amount)} ${spec.unit}` : t.number(amount),
								field: spec.label,
							}),
						}))}
						onPick={(key) => add(Number(key))}
					/>
				</div>
			)}
		</FieldShell>
	);
}

/** Seconds as editable text: "25" (minutes), "4 min 30 s", "1:30" past an hour. */
function durationText(seconds: number): string {
	if (seconds % 60 === 0 && seconds < 3600) return String(seconds / 60);
	if (seconds % 60 === 0) {
		const h = Math.floor(seconds / 3600);
		const m = (seconds % 3600) / 60;
		return `${h}:${m < 10 ? `0${m}` : m}`;
	}
	const m = Math.floor(seconds / 60);
	return m > 0 ? `${m} min ${seconds % 60} s` : `${seconds} s`;
}

function DurationField({ spec, value, onChange, error, disabled }: KindProps<"duration">) {
	const { t } = useT();
	const text = typeof value === "number" ? durationText(value) : asText(value);
	const minutesOnly = /^\s*\d+([.,]\d+)?\s*$/.test(text) || !text;
	const parsed = text ? parseDurationInput(text) : null;
	// Typed in another shape ("1:30", "45m"): say how it reads.
	const reading =
		parsed !== null && !minutesOnly && parsed > 0 ? t.formatDuration(parsed) : undefined;
	return (
		<FieldShell spec={spec} error={error}>
			{(ids) => (
				<div className="flex flex-col gap-2">
					<div
						className={cn(
							controlClass,
							"flex h-11 items-center gap-2 focus-within:border-accent focus-within:bg-surface focus-within:ring-3 focus-within:ring-accent/15",
							ids.invalid && "border-danger",
						)}
					>
						<input
							id={ids.id}
							type="text"
							inputMode="text"
							autoComplete="off"
							disabled={disabled}
							aria-describedby={ids.describedBy}
							aria-invalid={ids.invalid}
							placeholder={t("tracker.durationPlaceholder")}
							value={text}
							onChange={(event) => onChange(event.target.value)}
							className="h-full min-w-0 flex-1 bg-transparent tabular-nums outline-none"
						/>
						<span className="shrink-0 text-ink-muted text-small" aria-live="polite">
							{reading ?? (minutesOnly ? t("tracker.minutesShort") : null)}
						</span>
					</div>
					<QuickChips
						disabled={disabled}
						items={(spec.quick ?? []).map((minutes) => ({
							key: String(minutes),
							label: t.formatDuration(minutes * 60),
						}))}
						onPick={(key) => onChange(Number(key) * 60)}
					/>
				</div>
			)}
		</FieldShell>
	);
}

// ── Clock ─────────────────────────────────────────────────────────────────

function ClockField({ spec, value, onChange, error, disabled, autoFocus }: KindProps<"clock">) {
	const { t } = useT();
	const text = asText(value);
	const minutes = text ? parseClockInput(text) : null;
	const afterMidnight = spec.overnight && minutes !== null && minutes < 5 * 60;
	return (
		<FieldShell spec={spec} error={error}>
			{(ids) => (
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
					<input
						id={ids.id}
						data-autofocus={autoFocus ? "" : undefined}
						type="time"
						disabled={disabled}
						aria-describedby={ids.describedBy}
						aria-invalid={ids.invalid}
						value={/^\d{2}:\d{2}$/.test(text) ? text : ""}
						onChange={(event) => onChange(event.target.value.slice(0, 5))}
						className={cn(controlClass, "h-11 w-36 tabular-nums")}
					/>
					{afterMidnight ? (
						<span className="text-ink-muted text-small">{t("tracker.afterMidnight")}</span>
					) : null}
				</div>
			)}
		</FieldShell>
	);
}

// ── Choices ───────────────────────────────────────────────────────────────

interface RadioOption {
	value: string;
	label: ReactNode;
	ariaLabel?: string;
}

/**
 * A row (or grid) of chips with radio semantics: one tab stop, arrow keys
 * move and select (Annex K §4.1). Optional groups clear when the selected
 * chip is pressed again.
 */
function RadioChips({
	options,
	value,
	onChange,
	labelledBy,
	describedBy,
	layout = "chips",
	allowEmpty,
	disabled,
	autoFocus,
	extra,
}: {
	options: readonly RadioOption[];
	value: string | null;
	onChange(value: string | null): void;
	labelledBy: string;
	describedBy?: string;
	layout?: "chips" | "grid" | "row";
	allowEmpty?: boolean;
	disabled?: boolean;
	autoFocus?: boolean;
	/** Trailing chip (e.g. "Custom…"), part of the same arrow-key loop. */
	extra?: RadioOption & { checked: boolean; onSelect(): void };
}) {
	const refs = useRef<(HTMLButtonElement | null)[]>([]);
	const all = extra ? [...options, extra] : options;
	const checkedIndex = extra?.checked
		? options.length
		: options.findIndex((o) => o.value === value);
	const select = (index: number) => {
		if (extra && index === options.length) extra.onSelect();
		else {
			const option = options[index];
			if (option) onChange(option.value);
		}
	};
	const onKeyDown = (event: KeyboardEvent, index: number) => {
		const delta =
			event.key === "ArrowRight" || event.key === "ArrowDown"
				? 1
				: event.key === "ArrowLeft" || event.key === "ArrowUp"
					? -1
					: 0;
		if (!delta) return;
		event.preventDefault();
		const next = (index + delta + all.length) % all.length;
		select(next);
		refs.current[next]?.focus();
	};
	return (
		<div
			role="radiogroup"
			aria-labelledby={labelledBy}
			aria-describedby={describedBy}
			className={cn(
				layout === "grid"
					? // As many columns as fit with whole words ("Subscriptions", "Assinaturas").
						"grid grid-cols-[repeat(auto-fill,minmax(min(100%,8.75rem),1fr))] gap-1.5"
					: layout === "row"
						? "grid grid-cols-5 gap-1.5"
						: "flex flex-wrap gap-1.5",
			)}
		>
			{all.map((option, index) => {
				const checked = index === checkedIndex;
				const focusable = checkedIndex >= 0 ? checked : index === 0;
				return (
					<button
						key={option.value}
						ref={(el) => {
							refs.current[index] = el;
						}}
						type="button"
						// biome-ignore lint/a11y/useSemanticElements: chips with radio semantics and roving focus.
						role="radio"
						aria-checked={checked}
						aria-label={option.ariaLabel}
						tabIndex={focusable ? 0 : -1}
						data-autofocus={autoFocus && focusable ? "" : undefined}
						disabled={disabled}
						onClick={() => {
							if (checked && allowEmpty && !(extra && index === options.length)) onChange(null);
							else select(index);
						}}
						onKeyDown={(event) => onKeyDown(event, index)}
						className={cn(
							"inline-flex min-w-0 select-none items-center gap-1.5 rounded-full border font-medium text-small transition-colors duration-(--atomic-duration-fast) disabled:opacity-50",
							layout === "grid"
								? "h-auto min-h-10 justify-start rounded-lg px-3 py-2 text-left"
								: layout === "row"
									? "h-10 justify-center px-1"
									: "h-9 pointer-coarse:h-10 px-3",
							checked
								? "border-ink bg-ink text-bg"
								: "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink",
						)}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
}

function ChoiceField({ spec, value, onChange, error, disabled }: KindProps<"choice">) {
	const { t } = useT();
	const text = asText(value);
	const known = spec.options.some((o) => o.value === text);
	const [custom, setCustom] = useState(() => !!spec.custom && !!text && !known);
	const customRef = useRef<HTMLInputElement>(null);
	const customOn = !!spec.custom && (custom || (!!text && !known));
	return (
		<FieldShell spec={spec} error={error} group>
			{(ids) => (
				<div className="flex flex-col gap-2">
					<RadioChips
						labelledBy={ids.labelId}
						describedBy={ids.describedBy}
						layout={spec.layout}
						disabled={disabled}
						allowEmpty={!spec.required}
						value={customOn ? null : text || null}
						onChange={(next) => {
							setCustom(false);
							onChange(next ?? "");
						}}
						options={spec.options.map((option) => ({
							value: option.value,
							label: (
								<>
									{option.emoji ? (
										<span aria-hidden="true" className="shrink-0 font-emoji">
											{option.emoji}
										</span>
									) : null}
									<span className="min-w-0 break-words">{option.label}</span>
								</>
							),
						}))}
						extra={
							spec.custom
								? {
										value: "__custom",
										label: (
											<>
												<Plus aria-hidden="true" className="size-3.5 shrink-0" />
												<span>{t("tracker.custom")}</span>
											</>
										),
										checked: customOn,
										onSelect: () => {
											setCustom(true);
											if (known) onChange("");
											requestAnimationFrame(() => customRef.current?.focus());
										},
									}
								: undefined
						}
					/>
					{customOn && spec.custom ? (
						<input
							ref={customRef}
							type="text"
							aria-labelledby={ids.labelId}
							aria-invalid={ids.invalid}
							maxLength={spec.custom.max}
							disabled={disabled}
							placeholder={spec.custom.placeholder}
							value={known ? "" : text}
							onChange={(event) => onChange(event.target.value)}
							className={cn(controlClass, "h-11")}
						/>
					) : null}
				</div>
			)}
		</FieldShell>
	);
}

function RatingField({ spec, value, onChange, error, disabled }: KindProps<"rating">) {
	const selected = typeof value === "number" ? value : null;
	const chosen = selected ? spec.labels[selected - 1] : null;
	return (
		<FieldShell spec={spec} error={error} group>
			{(ids) => (
				<div className="flex flex-col gap-1.5">
					<RadioChips
						labelledBy={ids.labelId}
						describedBy={ids.describedBy}
						layout="row"
						allowEmpty={!spec.required}
						disabled={disabled}
						value={selected ? String(selected) : null}
						onChange={(next) => onChange(next ? Number(next) : null)}
						options={spec.labels.map((label, index) => ({
							value: String(index + 1),
							label: <span className="tabular-nums">{index + 1}</span>,
							ariaLabel: `${index + 1} · ${label}`,
						}))}
					/>
					<div className="flex justify-between gap-3 text-ink-subtle text-tiny" aria-hidden="true">
						<span className="min-w-0">{spec.labels[0]}</span>
						{chosen ? <span className="font-medium text-ink">{chosen}</span> : null}
						<span className="min-w-0 text-right">{spec.labels[spec.labels.length - 1]}</span>
					</div>
				</div>
			)}
		</FieldShell>
	);
}

function DayField({ spec, value, onChange, error, disabled }: KindProps<"day">) {
	return (
		<FieldShell spec={spec} error={error} group>
			{(ids) => (
				<RadioChips
					labelledBy={ids.labelId}
					describedBy={ids.describedBy}
					disabled={disabled}
					value={asText(value) || null}
					onChange={(next) => onChange(next ?? "")}
					options={spec.options.map((option) => ({ value: option.value, label: option.label }))}
				/>
			)}
		</FieldShell>
	);
}

// ── Text ──────────────────────────────────────────────────────────────────

function TextField({ spec, value, onChange, error, disabled }: KindProps<"text">) {
	const text = asText(value);
	const suggestions = spec.suggestions ?? [];
	return (
		<FieldShell spec={spec} error={error}>
			{(ids) =>
				suggestions.length ? (
					<Combobox
						id={ids.id}
						aria-describedby={ids.describedBy}
						aria-invalid={ids.invalid}
						aria-labelledby={ids.labelId}
						maxLength={spec.max}
						disabled={disabled}
						placeholder={spec.placeholder}
						value={text}
						onChange={(next) => onChange(next)}
						options={suggestions.map((s) => ({ value: s }))}
					/>
				) : (
					<input
						id={ids.id}
						type="text"
						autoComplete="off"
						aria-describedby={ids.describedBy}
						aria-invalid={ids.invalid}
						maxLength={spec.max}
						disabled={disabled}
						placeholder={spec.placeholder}
						value={text}
						onChange={(event) => onChange(event.target.value)}
						className={cn(controlClass, "h-11")}
					/>
				)
			}
		</FieldShell>
	);
}

function LongTextField({ spec, value, onChange, error, disabled }: KindProps<"longtext">) {
	return (
		<FieldShell spec={spec} error={error}>
			{(ids) => (
				<Textarea
					id={ids.id}
					autoGrow
					minRows={2}
					maxRows={8}
					aria-describedby={ids.describedBy}
					aria-invalid={ids.invalid}
					maxLength={spec.max}
					disabled={disabled}
					placeholder={spec.placeholder}
					value={asText(value)}
					onChange={(event) => onChange(event.target.value)}
				/>
			)}
		</FieldShell>
	);
}

function LinesField({ spec, value, onChange, error, disabled }: KindProps<"lines">) {
	const { t } = useT();
	const refs = useRef<(HTMLInputElement | null)[]>([]);
	const lines = Array.isArray(value) ? (value as string[]) : [];
	const rows = Math.max(spec.rows ?? spec.min, lines.length, 1);
	const shown = Array.from({ length: Math.min(spec.max, rows) }, (_, i) => lines[i] ?? "");
	const set = (index: number, text: string) => {
		const next = [...shown];
		next[index] = text;
		onChange(next);
	};
	const focusLine = (index: number) => requestAnimationFrame(() => refs.current[index]?.focus());
	const addLine = () => {
		onChange([...shown, ""]);
		focusLine(shown.length);
	};
	// Enter goes on to the next line, the way a list is written; the last line saves.
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
		if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.nativeEvent.isComposing)
			return;
		if (index < shown.length - 1) {
			event.preventDefault();
			refs.current[index + 1]?.focus();
		}
	};
	return (
		<FieldShell spec={spec} error={error} group>
			{(ids) => (
				<div className="flex flex-col gap-2">
					{shown.map((line, index) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: numbered input lines.
							key={index}
							className="flex items-center gap-2"
						>
							<span
								aria-hidden="true"
								className="w-4 shrink-0 text-right text-ink-subtle text-small tabular-nums"
							>
								{index + 1}
							</span>
							<input
								ref={(el) => {
									refs.current[index] = el;
								}}
								type="text"
								autoComplete="off"
								enterKeyHint={index < shown.length - 1 ? "next" : "done"}
								aria-label={`${spec.label} ${index + 1}`}
								aria-describedby={ids.describedBy}
								aria-invalid={ids.invalid}
								maxLength={spec.itemMax}
								disabled={disabled}
								placeholder={index === 0 ? spec.placeholder : undefined}
								value={line}
								onChange={(event) => set(index, event.target.value)}
								onKeyDown={(event) => onKeyDown(event, index)}
								className={cn(controlClass, "h-11 min-w-0 flex-1")}
							/>
						</div>
					))}
					{shown.length < spec.max ? (
						<button
							type="button"
							disabled={disabled}
							onClick={addLine}
							className="ml-4 inline-flex h-8 pointer-coarse:h-10 items-center gap-1.5 self-start rounded-full px-2 font-medium text-accent-text text-small hover:bg-accent-soft"
						>
							<Plus className="size-4" aria-hidden="true" />
							{t("tracker.addLine")}
						</button>
					) : null}
				</div>
			)}
		</FieldShell>
	);
}

// ── Book and photos ───────────────────────────────────────────────────────

function BookField({
	spec,
	value,
	onChange,
	error,
	books = [],
	onNewBook,
	disabled,
}: KindProps<"book">) {
	const { t } = useT();
	const selected = typeof value === "string" ? value : "";
	const options = books.filter((b) => b.status !== "abandoned" || b.id === selected);
	const missing = selected && !books.some((b) => b.id === selected);
	return (
		<FieldShell spec={spec} error={error}>
			{(ids) => (
				<div className="flex flex-wrap items-center gap-2">
					<select
						id={ids.id}
						aria-describedby={ids.describedBy}
						aria-invalid={ids.invalid}
						disabled={disabled}
						value={selected}
						onChange={(event) => onChange(event.target.value || null)}
						className={cn(controlClass, "h-11 min-w-0 flex-[1_1_14rem] pr-8")}
					>
						<option value="">{t("tracker.reading.noBook")}</option>
						{missing ? <option value={selected}>{t("tracker.reading.deletedBook")}</option> : null}
						{options.map((book) => (
							<option key={book.id} value={book.id}>
								{book.status === "reading"
									? book.title
									: `${book.title} · ${t(`tracker.bookStatus.${book.status}`)}`}
							</option>
						))}
					</select>
					{onNewBook ? (
						<button
							type="button"
							disabled={disabled}
							onClick={onNewBook}
							className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 font-medium text-ink text-small hover:border-line-strong hover:bg-hover"
						>
							<Plus className="size-4" aria-hidden="true" />
							{t("tracker.reading.newBook")}
						</button>
					) : null}
				</div>
			)}
		</FieldShell>
	);
}

function PhotosField({
	spec,
	value,
	onChange,
	error,
	disabled,
	day,
	onBusyChange,
	autoFocus,
}: KindProps<"photos">) {
	const { t } = useT();
	const photos = Array.isArray(value) ? (value as AttachmentRef[]) : [];
	// No photos in this build (the artifact): say so instead of a picker.
	if (!trackerCaps().photos) {
		return (
			<div className="flex min-w-0 flex-col gap-1.5">
				<span className="font-medium text-ink text-small">{spec.label}</span>
				<p className="flex items-center gap-2 rounded-lg bg-sunken/70 px-3 py-2.5 text-ink-muted text-small">
					<ImageOff className="size-4 shrink-0" aria-hidden="true" />
					{t("tracker.photosOff")}
				</p>
			</div>
		);
	}
	return (
		<FieldShell spec={spec} error={error} group>
			{(ids) => (
				<PhotoPicker
					value={photos}
					onChange={onChange}
					max={spec.max}
					day={day}
					disabled={disabled}
					labelId={ids.labelId}
					describedBy={ids.describedBy}
					invalid={ids.invalid}
					onBusyChange={onBusyChange}
					autoFocus={autoFocus}
				/>
			)}
		</FieldShell>
	);
}

/** The control that should take focus when the composer opens. */
export function firstFocusable(root: HTMLElement | null): HTMLElement | null {
	if (!root) return null;
	return (
		root.querySelector<HTMLElement>("[data-autofocus]") ??
		root.querySelector<HTMLElement>(
			'input:not(:disabled):not([type="file"]), textarea:not(:disabled), select:not(:disabled), [role="radio"][tabindex="0"]',
		)
	);
}
