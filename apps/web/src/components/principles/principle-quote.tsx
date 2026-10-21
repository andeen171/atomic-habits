import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { principleById } from "@atomic/core";
import { useLocale } from "@atomic/core/react";
import { Quote } from "lucide-react";
import { LawChip } from "../today/principle-card";

export interface PrincipleQuoteProps {
	/** A principle id (`principleById`), e.g. "identity", "small-wins" or `lawPrinciple(law, kind)`. */
	id: string;
	/** "card": a quote card at the top of Identity and Journal; "inline": one line in the blueprint header. */
	variant?: "inline" | "card";
	className?: string;
}

/**
 * One of the book's principles, quoted (item 8; spec §5.3, D60): a card at
 * the top of Identity and Journal, and an inline band in the blueprint
 * header (the principle of the habit's weakest law). Owner: T1.
 *
 * Only `text` and `text-muted` sit on the accent-soft surface: `text-subtle`
 * fails AA there.
 */
export function PrincipleQuote({ id, variant = "card", className }: PrincipleQuoteProps) {
	const { t } = useT();
	const locale = useLocale();
	const principle = principleById(id, locale);
	if (!principle) return null;

	if (variant === "inline") {
		return (
			<figure
				className={cn(
					"flex gap-3 rounded-lg border border-accent/15 bg-accent-soft/45 px-3.5 py-3",
					className,
				)}
			>
				<Quote aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-text" />
				<div className="min-w-0 flex-1">
					<figcaption className="sr-only">{t("principle.eyebrow")}</figcaption>
					<blockquote className="text-pretty text-small leading-relaxed">
						<span className="font-semibold text-ink">{principle.title}.</span>{" "}
						<span className="text-ink-muted">{principle.body}</span>
					</blockquote>
				</div>
			</figure>
		);
	}

	return (
		<figure
			className={cn(
				"relative overflow-hidden rounded-xl border border-accent/20 bg-gradient-to-br from-accent-soft/60 via-surface to-surface p-5 shadow-card md:p-6",
				className,
			)}
		>
			<span
				aria-hidden="true"
				className="pointer-events-none absolute top-0 right-6 select-none font-display text-[7.5rem] text-accent/12 leading-[0.8] md:right-10 md:text-[9rem]"
			>
				“
			</span>
			<figcaption className="relative flex flex-wrap items-center gap-2.5">
				<span className="font-semibold text-ink-muted text-tiny uppercase tracking-[0.08em]">
					{t("principle.eyebrow")}
				</span>
				<LawChip law={principle.law} />
			</figcaption>
			<blockquote className="relative mt-2.5 max-w-2xl">
				<p className="text-balance font-display text-[1.625rem] text-ink leading-[1.15] md:text-[1.875rem]">
					{principle.title}
				</p>
				<p className="mt-2 text-ink-muted leading-relaxed">{principle.body}</p>
			</blockquote>
		</figure>
	);
}
