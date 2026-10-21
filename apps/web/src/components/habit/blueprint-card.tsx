import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { type Habit, blueprintLines } from "@atomic/core";
import { Link } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { Button } from "../ui/button";

interface BlueprintCardProps {
	habit: Habit;
	/** "I am a reader" — rendered as the closing identity line. */
	identityStatement?: string | null;
	/** Show the edit CTA when empty (detail page) — hidden in previews. */
	editable?: boolean;
	compact?: boolean;
}

const LAWS = [1, 2, 3, 4] as const;

/** The four laws applied to one habit, as readable sentences. */
export function BlueprintCard({
	habit,
	identityStatement,
	editable = true,
	compact,
}: BlueprintCardProps) {
	const { t } = useT();
	const lines = blueprintLines(habit, t);
	const isBreak = habit.kind === "break";

	if (!lines.length && editable) {
		return (
			<div className="flex flex-col items-start gap-3 rounded-lg bg-sunken/70 p-4">
				<p className="text-ink-muted">{t("detail.blueprintEmpty")}</p>
				<Button asChild variant="secondary" size="sm">
					<Link to="/habits/$habitId/edit" params={{ habitId: habit.id }}>
						<Pencil />
						{t("common.edit")}
					</Link>
				</Button>
			</div>
		);
	}

	return (
		<div>
			<ol className={cn("flex flex-col", compact ? "gap-3" : "gap-4")}>
				{LAWS.map((law) => {
					const sentences = lines.filter((line) => line.law === law);
					return (
						<li key={law} className="flex gap-3">
							<span
								aria-hidden="true"
								className={cn(
									"grid size-6 shrink-0 place-items-center rounded-full font-semibold text-[11px] tabular-nums",
									sentences.length
										? "bg-accent-soft text-ink dark:text-accent-text"
										: "bg-sunken text-ink-muted",
								)}
							>
								{law}
							</span>
							<div className="min-w-0 flex-1 pt-0.5">
								<p className="font-medium text-ink text-small">
									{t(isBreak ? `law.${law}.inverse` : `law.${law}.name`)}{" "}
									<span className="ml-1 font-normal text-ink-subtle text-tiny uppercase tracking-wider">
										{t(`law.${law}.stage`)}
									</span>
								</p>
								{sentences.length ? (
									sentences.map((line) => (
										<p key={line.text} className="mt-0.5 text-ink-muted text-small">
											{line.text}
										</p>
									))
								) : (
									<p className="mt-0.5 text-ink-subtle text-small">—</p>
								)}
							</div>
						</li>
					);
				})}
			</ol>
			{identityStatement ? (
				<div className={cn("border-line border-t", compact ? "mt-4 pt-4" : "mt-5 pt-5")}>
					<p className="section-label">{t("detail.identity")}</p>
					<p className={cn("mt-1 font-display text-ink italic", compact ? "text-h3" : "text-h2")}>
						{identityStatement}
					</p>
				</div>
			) : null}
		</div>
	);
}
