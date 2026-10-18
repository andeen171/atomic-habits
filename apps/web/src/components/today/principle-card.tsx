import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { principleOfTheDay } from "@atomic/core";
import { useLocale, useToday } from "@atomic/core/react";
import { Quote } from "lucide-react";

export function PrincipleCard({ className }: { className?: string }) {
	const { t } = useT();
	const today = useToday();
	const locale = useLocale();
	const principle = principleOfTheDay(today, locale);
	const law = principle.law >= 1 && principle.law <= 4 ? (principle.law as 1 | 2 | 3 | 4) : null;

	return (
		<section
			aria-label={t("today.principle")}
			className={cn(
				"relative overflow-hidden rounded-xl border border-line bg-surface p-5 shadow-card md:p-6",
				className,
			)}
		>
			<Quote aria-hidden="true" className="absolute top-4 right-4 size-10 text-accent/15" />
			<div className="mb-3 flex items-center gap-2">
				<span className="section-label">{t("today.principle")}</span>
				{law ? (
					<span className="rounded-full bg-sunken px-2 py-0.5 font-medium text-[10px] text-ink-muted uppercase tracking-wide">
						{t(`law.${law}.name`)}
					</span>
				) : null}
			</div>
			<h3 className="font-display text-[1.625rem] text-ink leading-tight">{principle.title}</h3>
			<p className="mt-2 text-ink-muted text-small leading-relaxed">{principle.body}</p>
		</section>
	);
}
