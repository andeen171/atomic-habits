import type { AgendaItem } from "@atomic/core";
import { Sprout, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";

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
	return (
		<div
			role="status"
			className={cn(
				"flex gap-3.5 rounded-xl p-4 md:p-5",
				tone === "warning" ? "bg-warning-soft" : "border border-line bg-sunken/60",
			)}
		>
			<span
				className={cn(
					"grid size-9 shrink-0 place-items-center rounded-full [&_svg]:size-[18px]",
					tone === "warning" ? "bg-warning/15 text-warning" : "bg-surface text-success",
				)}
			>
				{icon}
			</span>
			<div className="min-w-0 flex-1">
				<p className="font-semibold text-ink">{title}</p>
				<p className="mt-0.5 text-ink-muted text-small">{body}</p>
				{children}
			</div>
		</div>
	);
}

/** "Never miss twice" — gentle and specific, never guilt. */
export function NeverMissTwiceBanner({ items }: { items: AgendaItem[] }) {
	const { t, tp } = useT();
	const first = items[0];
	if (!first) return null;
	const body = items.length === 1 ? t("nmt.body", { habit: first.habit.name }) : tp("nmt.bodyMany", items.length);
	return (
		<Banner tone="warning" icon={<TriangleAlert />} title={t("nmt.title")} body={body}>
			{items.length > 1 ? (
				<div className="mt-2.5 flex flex-wrap gap-1.5">
					{items.map((item) => (
						<span
							key={item.habit.id}
							className="inline-flex h-6 items-center gap-1 rounded-full bg-surface/70 px-2 font-medium text-ink text-tiny"
						>
							<span className="font-emoji">{item.habit.emoji}</span>
							{item.habit.name}
						</span>
					))}
				</div>
			) : null}
		</Banner>
	);
}

export function FreshStartBanner({ items }: { items: AgendaItem[] }) {
	const { t } = useT();
	if (!items.length) return null;
	return <Banner tone="muted" icon={<Sprout />} title={t("nmt.freshStart")} body={t("nmt.freshStartBody")} />;
}
