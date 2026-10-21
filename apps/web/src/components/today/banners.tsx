import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { type AgendaItem, type JournalEntry, recoveryFor, recoveryPlanText } from "@atomic/core";
import { useJournal, useText } from "@atomic/core/react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, PenLine, RefreshCw, Sprout, TriangleAlert } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Button } from "../ui/button";

function Banner({
	icon,
	title,
	body,
	tone,
	children,
}: {
	icon: ReactNode;
	title: string;
	body: string;
	tone: "warning" | "muted";
	children?: ReactNode;
}) {
	const titleId = useId();
	return (
		<section
			aria-labelledby={titleId}
			className={cn(
				"flex gap-3.5 rounded-xl p-4 md:p-5",
				tone === "warning" ? "bg-warning-soft" : "border border-line bg-sunken/60",
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"grid size-9 shrink-0 place-items-center rounded-full [&_svg]:size-[18px]",
					tone === "warning" ? "bg-warning/15 text-warning" : "bg-surface text-success",
				)}
			>
				{icon}
			</span>
			<div className="min-w-0 flex-1">
				<h2 id={titleId} className="font-semibold text-ink">
					{title}
				</h2>
				<p className="mt-0.5 text-ink-muted text-small">{body}</p>
				{children}
			</div>
		</section>
	);
}

/** A banner item with its comeback plan for the miss that put it here (Annex J §1.5). */
interface Planned {
	item: AgendaItem;
	plan: JournalEntry | undefined;
}

function usePlans(items: readonly AgendaItem[]): Planned[] {
	const journal = useJournal();
	return items.map((item) => ({
		item,
		plan: item.streak.lastMiss
			? recoveryFor(journal, item.habit.id, item.streak.lastMiss)
			: undefined,
	}));
}

/** The editor for an item: its plan, or a new comeback plan for the day it was missed. */
function PlanLink({
	planned,
	className,
	children,
}: {
	planned: Planned;
	className?: string;
	children: ReactNode;
}) {
	const { item, plan } = planned;
	if (plan) {
		return (
			<Link to="/journal/$entryId" params={{ entryId: plan.id }} className={className}>
				{children}
			</Link>
		);
	}
	return (
		<Link
			to="/journal/new"
			search={{
				kind: "recovery",
				habit: item.habit.id,
				date: item.streak.lastMiss ?? undefined,
			}}
			className={className}
		>
			{children}
		</Link>
	);
}

/**
 * One habit's plan: "Your plan: …" with "Edit plan" once a comeback plan
 * exists for the miss, otherwise the button that writes one (prefilled with
 * the habit and the missed day). `lead` (the habit, when the banner's text
 * doesn't name it) goes beside the button, or above the plan.
 */
function SinglePlan({
	planned,
	action,
	lead,
}: {
	planned: Planned;
	action: string;
	lead?: ReactNode;
}) {
	const { t } = useT();
	const { item, plan } = planned;
	if (!plan) {
		return (
			<div className="mt-3 flex flex-wrap items-center gap-2">
				{lead}
				<Button variant="secondary" size="sm" asChild>
					<PlanLink planned={planned}>
						<PenLine />
						{action}
					</PlanLink>
				</Button>
			</div>
		);
	}
	const line = recoveryPlanText(plan, item.habit, t);
	return (
		<>
			{lead ? <div className="mt-2.5 flex">{lead}</div> : null}
			<div className="mt-3 flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-lg bg-surface/80 px-3 py-2.5">
				<p className="flex min-w-0 flex-[1_1_14rem] items-start gap-2 text-ink text-small">
					<RefreshCw aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-ink-muted" />
					<span className="min-w-0 break-words">
						{line ? t("journal.nmt.yourPlan", { plan: line }) : t("journal.nmt.planSaved")}
					</span>
				</p>
				<PlanLink
					planned={planned}
					className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-xs font-medium text-accent-text text-small underline-offset-4 hover:underline"
				>
					{t("journal.nmt.editPlan")}
					<ArrowRight aria-hidden="true" className="size-3.5" />
				</PlanLink>
			</div>
		</>
	);
}

/**
 * Several habits: each is a chip linking to its plan (✓ when one exists) or
 * to a new one, in a list named by the action ("Plan the comeback").
 */
function PlanChips({ plans, action }: { plans: Planned[]; action: string }) {
	const { t } = useT();
	const text = useText();
	const labelId = useId();
	return (
		<div className="mt-2.5">
			<p id={labelId} className="font-medium text-ink-muted text-tiny">
				{action}
			</p>
			<ul aria-labelledby={labelId} className="mt-1.5 flex flex-wrap gap-1.5">
				{plans.map((planned) => {
					const { item, plan } = planned;
					const name = text.habit(item.habit, "name");
					return (
						<li key={item.habit.id} className="min-w-0 max-w-full">
							<PlanLink
								planned={planned}
								className={cn(
									"inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-ink text-tiny transition-colors duration-(--atomic-duration-fast)",
									"border bg-surface/80 hover:bg-surface",
									plan ? "border-success/40" : "border-line hover:border-line-strong",
								)}
							>
								<span aria-hidden="true" className="font-emoji">
									{item.habit.emoji}
								</span>
								<span className="min-w-0 truncate">{name}</span>
								{plan ? (
									<>
										<Check aria-hidden="true" className="size-3.5 shrink-0 text-success" />
										<span className="sr-only">, {t("journal.nmt.planSaved")}</span>
									</>
								) : (
									<PenLine aria-hidden="true" className="size-3 shrink-0 text-ink-muted" />
								)}
							</PlanLink>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

/**
 * "Never miss twice" — gentle and specific, never guilt. Each habit at risk
 * gets its comeback plan for the miss (Annex J §1.5): the plan itself with
 * "Edit plan", or "Plan the comeback" (several habits: a chip each, ✓ when
 * planned).
 */
export function NeverMissTwiceBanner({ items }: { items: AgendaItem[] }) {
	const { t, tp } = useT();
	const text = useText();
	const plans = usePlans(items);
	const first = plans[0];
	if (!first) return null;
	const body =
		plans.length === 1
			? t("nmt.body", { habit: text.habit(first.item.habit, "name") })
			: tp("nmt.bodyMany", plans.length);
	return (
		<Banner tone="warning" icon={<TriangleAlert />} title={t("nmt.title")} body={body}>
			{plans.length === 1 ? (
				<SinglePlan planned={first} action={t("journal.nmt.plan")} />
			) : (
				<PlanChips plans={plans} action={t("journal.nmt.plan")} />
			)}
		</Banner>
	);
}

/**
 * Two misses in a row: begin again. The body is general, so the habit is
 * always named — one habit as a chip beside "Plan a fresh start" (or its
 * plan), several as chips.
 */
export function FreshStartBanner({ items }: { items: AgendaItem[] }) {
	const { t } = useT();
	const text = useText();
	const plans = usePlans(items);
	const first = plans[0];
	if (!first) return null;
	const action = t("journal.nmt.freshPlan");
	return (
		<Banner
			tone="muted"
			icon={<Sprout />}
			title={t("nmt.freshStart")}
			body={t("nmt.freshStartBody")}
		>
			{plans.length === 1 ? (
				<SinglePlan
					planned={first}
					action={action}
					lead={
						<span className="inline-flex min-h-8 max-w-full items-center gap-1.5 pr-1 font-semibold text-ink text-small">
							<span aria-hidden="true" className="font-emoji">
								{first.item.habit.emoji}
							</span>
							<span className="min-w-0 break-words">{text.habit(first.item.habit, "name")}</span>
						</span>
					}
				/>
			) : (
				<PlanChips plans={plans} action={action} />
			)}
		</Banner>
	);
}
