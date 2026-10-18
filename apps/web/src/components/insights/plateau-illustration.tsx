import { useId } from "react";

const EXPECTED = "M10 110 L206 20";
const ACTUAL = "M10 110 C 110 108, 150 100, 175 62 S 200 12, 206 8";

/** Expectation (straight line) vs reality (compounding curve) — the valley of disappointment. */
export function PlateauIllustration({ className }: { className?: string }) {
	const maskId = useId();
	return (
		<svg viewBox="0 0 220 120" fill="none" aria-hidden="true" className={className}>
			<defs>
				<mask id={maskId}>
					<path d={`${EXPECTED} L206 110 Z`} fill="white" />
					<path d={`${ACTUAL} L206 110 Z`} fill="black" />
				</mask>
			</defs>
			<rect
				x="10"
				y="8"
				width="200"
				height="102"
				fill="var(--warning)"
				fillOpacity=".14"
				mask={`url(#${maskId})`}
			/>
			<line x1="10" y1="110" x2="210" y2="110" stroke="var(--border-strong)" />
			<line x1="10" y1="110" x2="10" y2="8" stroke="var(--border-strong)" />
			<path
				d={EXPECTED}
				stroke="var(--text-subtle)"
				strokeWidth="2"
				strokeDasharray="5 5"
				strokeLinecap="round"
			/>
			<path d={ACTUAL} stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
			<circle
				cx="206"
				cy="8"
				r="4.5"
				fill="var(--accent)"
				stroke="var(--surface)"
				strokeWidth="2"
			/>
		</svg>
	);
}
