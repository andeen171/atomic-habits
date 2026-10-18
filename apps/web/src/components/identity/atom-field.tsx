import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import type { HabitColor } from "@atomic/core";

const MAX_DOTS = 200;

/** A field of small "atoms": one per vote, scaled down past 200. Recent votes glow. */
export function AtomField({
	votes,
	recent,
	color,
}: { votes: number; recent: number; color: HabitColor }) {
	const { t, at } = useT();
	const style = useHabitStyle(color);
	if (votes <= 0) return null;
	const scale = Math.max(1, Math.ceil(votes / MAX_DOTS));
	const dots = Math.max(1, Math.round(votes / scale));
	const bright = Math.min(dots, Math.round(recent / scale));
	return (
		<figure style={style}>
			<div role="img" aria-label={t.tp("common.votes", votes)} className="flex flex-wrap gap-[3px]">
				{Array.from({ length: dots }, (_, i) => (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: dots are positional and identical.
						key={i}
						className="size-[7px] rounded-full"
						style={{ background: "var(--habit)", opacity: i >= dots - bright ? 1 : 0.32 }}
					/>
				))}
			</div>
			<figcaption className="mt-2 text-ink-subtle text-tiny">
				{scale === 1
					? at("identity.atoms")
					: at("identity.atomsScaled", { count: t.number(scale) })}
			</figcaption>
		</figure>
	);
}
