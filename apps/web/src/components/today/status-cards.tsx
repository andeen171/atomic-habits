import { useT } from "@/lib/messages";
import {
	type DayKey,
	type Habit,
	type Identity,
	type LogIndex,
	dayVotes,
	isActiveOn,
	journalKindUnavailable,
	logsFor,
} from "@atomic/core";
import { useAtomic, useIdentities, useLogIndex, useToday } from "@atomic/core/react";
import { Link } from "@tanstack/react-router";
import { PenLine } from "lucide-react";
import { motion } from "motion/react";
import { useMemo } from "react";
import { Button } from "../ui/button";

/**
 * The identity that got the most votes on `day` (ties: the first in the
 * user's order), or null when no identity-linked habit counted a vote.
 */
function topIdentityOn(
	day: DayKey,
	habits: Readonly<Record<string, Habit>>,
	identities: readonly Identity[],
	index: LogIndex,
): Identity | null {
	const votes = new Map<string, number>();
	for (const habit of Object.values(habits)) {
		if (habit.deletedAt || habit.kind !== "build" || !habit.identityId) continue;
		if (!isActiveOn(habit, day)) continue;
		const count = logsFor(index, habit.id).get(day)?.count ?? 0;
		const cast = dayVotes(habit, day, count);
		if (cast > 0) votes.set(habit.identityId, (votes.get(habit.identityId) ?? 0) + cast);
	}
	let best: Identity | null = null;
	let most = 0;
	for (const identity of identities) {
		const n = votes.get(identity.id) ?? 0;
		if (n > most) {
			best = identity;
			most = n;
		}
	}
	return best;
}

/**
 * "Write down the proof" (Annex J §1.5): evidence for the identity that got
 * the most votes today. With no identity at all evidence can't be written,
 * so the link is left out; when no identity got a vote, the editor asks.
 */
function ProofLink() {
	const { t } = useT();
	const today = useToday();
	const habits = useAtomic((s) => s.data.habits);
	const identities = useIdentities();
	const index = useLogIndex();
	const identity = useMemo(
		() => topIdentityOn(today, habits, identities, index),
		[today, habits, identities, index],
	);
	const unavailable = journalKindUnavailable("evidence", {
		habits: Object.values(habits),
		identities,
	});
	if (unavailable) return null;
	return (
		<Button variant="secondary" size="sm" asChild className="mt-4">
			<Link
				to="/journal/new"
				search={identity ? { kind: "evidence", identity: identity.id } : { kind: "evidence" }}
			>
				<PenLine />
				{t("journal.proof.cta")}
			</Link>
		</Button>
	);
}

export function AllDoneCard({ votes }: { votes: number }) {
	const { t, tp } = useT();
	return (
		<motion.div
			initial={{ opacity: 0, y: 8, scale: 0.98 }}
			animate={{ opacity: 1, y: 0, scale: 1 }}
			transition={{ type: "spring", stiffness: 260, damping: 24 }}
			className="relative overflow-hidden rounded-xl border border-accent/25 bg-accent-soft/60 p-5 md:p-6"
		>
			<svg
				aria-hidden="true"
				viewBox="0 0 120 120"
				className="-top-6 -right-6 absolute size-32 opacity-60"
			>
				<ellipse
					cx="60"
					cy="60"
					rx="50"
					ry="19"
					fill="none"
					stroke="var(--accent)"
					strokeOpacity=".35"
					strokeWidth="2"
					transform="rotate(35 60 60)"
				/>
				<ellipse
					cx="60"
					cy="60"
					rx="50"
					ry="19"
					fill="none"
					stroke="var(--accent)"
					strokeOpacity=".2"
					strokeWidth="2"
					transform="rotate(-35 60 60)"
				/>
				<circle cx="60" cy="60" r="8" fill="var(--accent)" fillOpacity=".7" />
			</svg>
			<p className="font-display text-ink text-title">{t("today.allDone")}</p>
			<p className="mt-1 max-w-md text-ink-muted">{t("today.allDoneBody")}</p>
			{votes > 0 ? (
				<p className="mt-3 font-semibold text-ink text-small dark:text-accent-text">
					{tp("today.votesToday", votes)}
				</p>
			) : null}
			<ProofLink />
		</motion.div>
	);
}

/** Nothing scheduled for the day; a viewed past day gets the past-tense title only. */
export function NothingDueCard({ past }: { past?: boolean }) {
	const { t } = useT();
	return (
		<div className="rounded-xl border border-line border-dashed bg-surface/50 p-5 text-center md:p-6">
			<p className="font-display text-h2 text-ink">
				{past ? t("today.nothingDueDay") : t("today.nothingDue")}
			</p>
			{past ? null : <p className="mt-1 text-ink-muted text-small">{t("today.nothingDueBody")}</p>}
		</div>
	);
}
