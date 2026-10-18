import type { IdentityStats } from "@atomic/core";
import { useActions } from "@atomic/core/react";
import { Link } from "@tanstack/react-router";
import { Ellipsis, Pencil, Plus, Trash } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { IconButton } from "../ui/icon-button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../ui/menu";
import { AtomField } from "./atom-field";
import { IdentityDialog } from "./identity-dialog";

export function IdentityCard({ stats }: { stats: IdentityStats }) {
	const { t, at } = useT();
	const actions = useActions();
	const { identity, votes, recentVotes, habits } = stats;
	const style = useHabitStyle(identity.color);
	const [editing, setEditing] = useState(false);
	const [deleting, setDeleting] = useState(false);

	return (
		<article style={style} className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-5 shadow-card md:p-6">
			<header className="flex items-start gap-3.5">
				<span className="grid size-12 shrink-0 place-items-center rounded-lg bg-(--habit-soft) font-emoji text-2xl">
					{identity.emoji}
				</span>
				<h2 className="min-w-0 flex-1 pt-1 font-display text-[1.625rem] text-ink leading-tight">{identity.statement}</h2>
				<Menu modal={false}>
					<MenuTrigger asChild>
						<IconButton label={t("common.more")} size="sm" tooltip={false} className="-mr-1.5">
							<Ellipsis />
						</IconButton>
					</MenuTrigger>
					<MenuContent>
						<MenuItem icon={<Pencil />} onSelect={() => setEditing(true)}>
							{t("common.edit")}
						</MenuItem>
						<MenuSeparator />
						<MenuItem icon={<Trash />} destructive onSelect={() => setDeleting(true)}>
							{t("common.delete")}
						</MenuItem>
					</MenuContent>
				</Menu>
			</header>

			<div className="flex items-end gap-3">
				<div>
					<div className="section-label">{t("identity.votes")}</div>
					<div className="font-display text-[3rem] text-ink tabular-nums leading-none">{t.number(votes)}</div>
				</div>
				{recentVotes > 0 ? (
					<span className="mb-1 rounded-full bg-success-soft px-2 py-0.5 font-semibold text-ink text-tiny tabular-nums">
						{at("identity.thisWeek", { count: t.number(recentVotes) })}
					</span>
				) : null}
			</div>

			{votes > 0 ? (
				<AtomField votes={votes} recent={recentVotes} color={identity.color} />
			) : (
				<p className="text-ink-subtle text-small">{t("identity.evidenceBody", { votes: 0 })}</p>
			)}

			<div className="border-line border-t pt-4">
				<div className="mb-2 section-label">{t("identity.habits")}</div>
				<div className="flex flex-wrap gap-1.5">
					{habits.map((habit) => (
						<Link
							key={habit.id}
							to="/habits/$habitId"
							params={{ habitId: habit.id }}
							className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-ink text-small transition-colors hover:border-line-strong hover:bg-hover"
						>
							<span className="font-emoji">{habit.emoji}</span>
							{habit.name}
						</Link>
					))}
					<Link
						to="/habits/new"
						search={{ identity: identity.id }}
						className="inline-flex h-8 items-center gap-1 rounded-full border border-line-strong border-dashed px-3 text-ink-muted text-small transition-colors hover:border-ink-subtle hover:text-ink"
					>
						<Plus className="size-3.5" />
						{t("identity.linkHabit")}
					</Link>
				</div>
				{habits.length === 0 ? <p className="mt-2 text-ink-subtle text-small">{t("identity.noHabits")}</p> : null}
			</div>

			<IdentityDialog open={editing} onOpenChange={setEditing} identity={identity} />
			<ConfirmDialog
				open={deleting}
				onOpenChange={setDeleting}
				title={t("identity.deleteTitle")}
				body={t("identity.deleteBody")}
				confirmLabel={t("common.delete")}
				destructive
				onConfirm={() => actions.deleteIdentity(identity.id)}
			/>
		</article>
	);
}
