import { useTheme } from "@/lib/theme";
import Svg, { Circle, Ellipse } from "react-native-svg";

/** The Atomic mark: two orbits, an ember nucleus and one electron. */
export function Logo({ size = 64, ink, accent }: { size?: number; ink?: string; accent?: string }) {
	const { colors } = useTheme();
	const stroke = ink ?? colors.text;
	const nucleus = accent ?? colors.accent;
	return (
		<Svg width={size} height={size} viewBox="0 0 100 100" accessibilityRole="image">
			<Ellipse
				cx={50}
				cy={50}
				rx={40}
				ry={15.5}
				stroke={stroke}
				strokeWidth={6.5}
				strokeOpacity={0.42}
				fill="none"
				transform="rotate(45 50 50)"
			/>
			<Ellipse
				cx={50}
				cy={50}
				rx={40}
				ry={15.5}
				stroke={stroke}
				strokeWidth={6.5}
				fill="none"
				transform="rotate(-45 50 50)"
			/>
			<Circle cx={50} cy={50} r={10} fill={nucleus} />
			<Circle cx={78.3} cy={21.7} r={6} fill={nucleus} />
		</Svg>
	);
}
