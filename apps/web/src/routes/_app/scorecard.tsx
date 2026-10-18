import { Page, PageHeader } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { SCORECARD_RATINGS, type ScorecardItem, type ScorecardRating } from "@atomic/core";
import { useActions, useScorecard } from "@atomic/core/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ClipboardList, Ellipsis, Plus, ShieldOff, Sprout, Trash } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type FormEvent, type KeyboardEvent, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/scorecard")({
	component: ScorecardScreen,
});

function ScorecardScreen() {
	const { t } = useT();
	const items = useScorecard();
	const counts = { positive: 0, neutral: 0, negative: 0 };
	for (const item of items) counts[item.rating]++;

	return (
		<Page>
			<PageHeader title={t("scorecard.title")} subtitle={t("scorecard.subtitle")} />
			<div className="mb-6 flex gap-4 rounded-xl border border-line bg-surface p-5 shadow-card">
				<span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
					<ClipboardList className="size-5" />
				</span>
				<p className="text-ink-muted">{t("scorecard.intro")}</p>
			</div>

			<AddBehavior />

			{items.length ? (
				<>
					<ScorecardSummary counts={counts} total={items.length} />
					<div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
						<AnimatePresence initial={false}>
							{items.map((item, index) => (
								<motion.div
									key={item.id}
									initial={{ opacity: 0, height: 0 }}
									animate={{ opacity: 1, height: "auto" }}
									exit={{ opacity: 0, height: 0 }}
									className={cn(index > 0 && "border-line border-t")}
								>
									<ScorecardRow item={item} />
								</motion.div>
							))}
						</AnimatePresence>
					</div>
				</>
			) : (
				<div className="mt-8 rounded-2xl border border-line bg-surface shadow-card">
					<EmptyState compact title={t("scorecard.empty")} body={t("scorecard.emptyBody")} />
				</div>
			)}
		</Page>
	);
}

function ScorecardSummary({
	counts,
	total,
}: { counts: Record<ScorecardRating, number>; total: number }) {
	const { t } = useT();
	const tone: Record<ScorecardRating, string> = {
		positive: "bg-success",
		neutral: "bg-line-strong",
		negative: "bg-danger",
	};
	return (
		<div className="mt-8 mb-3 px-1">
			<p className="text-ink-muted text-small">{t("scorecard.summary", counts)}</p>
			<div className="mt-2 flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
				{SCORECARD_RATINGS.map((rating) =>
					counts[rating] ? (
						<span
							key={rating}
							className={tone[rating]}
							style={{ width: `${(counts[rating] / total) * 100}%` }}
						/>
					) : null,
				)}
			</div>
		</div>
	);
}

function AddBehavior() {
	const { t } = useT();
	const actions = useActions();
	const [label, setLabel] = useState("");
	const [time, setTime] = useState("");
	const [rating, setRating] = useState<ScorecardRating>("neutral");

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!label.trim()) return;
		actions.createScorecardItem({ label, rating, time: time || null });
		setLabel("");
		setRating("neutral");
	};

	return (
		<form
			onSubmit={submit}
			className="rounded-xl border border-line bg-surface p-4 shadow-card md:p-5"
		>
			<div className="flex flex-col gap-3 sm:flex-row">
				<Input
					type="time"
					value={time}
					aria-label={t("scorecard.time")}
					onChange={(event) => setTime(event.target.value)}
					className="sm:w-32"
				/>
				<Input
					value={label}
					maxLength={160}
					aria-label={t("scorecard.add")}
					placeholder={t("scorecard.placeholder")}
					onChange={(event) => setLabel(event.target.value)}
				/>
			</div>
			<div className="mt-3 flex items-center justify-between gap-3">
				<RatingPicker value={rating} onChange={setRating} />
				<Button type="submit" disabled={!label.trim()}>
					<Plus />
					{t("scorecard.add")}
				</Button>
			</div>
		</form>
	);
}

const RATING_SYMBOL: Record<ScorecardRating, string> = {
	positive: "+",
	neutral: "=",
	negative: "−",
};
const RATING_STYLE: Record<ScorecardRating, string> = {
	positive: "aria-checked:bg-success-soft aria-checked:text-success aria-checked:border-success/40",
	neutral: "aria-checked:bg-sunken aria-checked:text-ink aria-checked:border-line-strong",
	negative: "aria-checked:bg-danger-soft aria-checked:text-danger aria-checked:border-danger/40",
};

function RatingPicker({
	value,
	onChange,
}: { value: ScorecardRating; onChange(rating: ScorecardRating): void }) {
	const { t, at } = useT();
	const onKeyDown = (event: KeyboardEvent, index: number) => {
		const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
		if (!delta) return;
		event.preventDefault();
		const next =
			SCORECARD_RATINGS[(index + delta + SCORECARD_RATINGS.length) % SCORECARD_RATINGS.length];
		if (next) onChange(next);
	};
	return (
		<div
			role="radiogroup"
			aria-label={at("scorecard.rating")}
			className="inline-flex shrink-0 gap-1"
		>
			{SCORECARD_RATINGS.map((rating, index) => (
				<button
					key={rating}
					type="button"
					// biome-ignore lint/a11y/useSemanticElements: styled control with full ARIA state and keyboard support.
					role="radio"
					aria-checked={value === rating}
					aria-label={t(`scorecard.rating.${rating}`)}
					title={t(`scorecard.rating.${rating}`)}
					tabIndex={value === rating ? 0 : -1}
					onKeyDown={(event) => onKeyDown(event, index)}
					onClick={() => onChange(rating)}
					className={cn(
						"grid size-8 place-items-center rounded-full border border-transparent font-semibold text-[1.0625rem] text-ink-subtle leading-none transition-colors hover:bg-hover hover:text-ink",
						RATING_STYLE[rating],
					)}
				>
					{RATING_SYMBOL[rating]}
				</button>
			))}
		</div>
	);
}

function ScorecardRow({ item }: { item: ScorecardItem }) {
	const { t } = useT();
	const actions = useActions();
	const navigate = useNavigate();
	const [editing, setEditing] = useState(false);
	const [label, setLabel] = useState(item.label);

	const commit = () => {
		setEditing(false);
		if (label.trim() && label !== item.label) actions.updateScorecardItem(item.id, { label });
		else setLabel(item.label);
	};

	const remove = () => {
		actions.deleteScorecardItem(item.id);
		toast(t("common.deleted"), {
			description: item.label,
			action: {
				label: t("common.undo"),
				onClick: () =>
					actions.createScorecardItem({
						label: item.label,
						rating: item.rating,
						time: item.time,
						order: item.order,
					}),
			},
		});
	};

	const kind = item.rating === "negative" ? "break" : "build";

	return (
		<div className="flex items-center gap-2 px-4 py-2.5 sm:gap-3 md:px-5">
			<span className="w-10 shrink-0 text-ink-subtle text-small tabular-nums sm:w-12">
				{item.time ?? "—"}
			</span>
			{editing ? (
				<input
					value={label}
					// biome-ignore lint/a11y/noAutofocus: the field appears because the user clicked to edit it.
					autoFocus
					maxLength={160}
					aria-label={t("common.edit")}
					onChange={(event) => setLabel(event.target.value)}
					onBlur={commit}
					onKeyDown={(event) => {
						if (event.key === "Enter") commit();
						if (event.key === "Escape") {
							setLabel(item.label);
							setEditing(false);
						}
					}}
					className="h-9 min-w-0 flex-1 rounded-sm border border-accent bg-surface px-2 text-ink outline-none focus-visible:outline-none"
				/>
			) : (
				<button
					type="button"
					onClick={() => setEditing(true)}
					className="line-clamp-2 min-w-0 flex-1 rounded-sm py-1.5 text-left text-ink leading-snug"
				>
					{item.label}
				</button>
			)}
			<RatingPicker
				value={item.rating}
				onChange={(rating) => actions.updateScorecardItem(item.id, { rating })}
			/>
			<Menu modal={false}>
				<MenuTrigger asChild>
					<IconButton
						label={t("common.more")}
						size="sm"
						tooltip={false}
						className="-mr-1.5 text-ink-subtle"
					>
						<Ellipsis />
					</IconButton>
				</MenuTrigger>
				<MenuContent>
					<MenuItem
						icon={kind === "break" ? <ShieldOff /> : <Sprout />}
						onSelect={() => navigate({ to: "/habits/new", search: { name: item.label, kind } })}
					>
						{kind === "break" ? t("scorecard.breakHabit") : t("scorecard.makeHabit")}
					</MenuItem>
					<MenuSeparator />
					<MenuItem icon={<Trash />} destructive onSelect={remove}>
						{t("common.delete")}
					</MenuItem>
				</MenuContent>
			</Menu>
		</div>
	);
}
