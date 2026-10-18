import type { ReactNode } from "react";
import { View } from "react-native";
import Svg, { Circle, Ellipse, G } from "react-native-svg";
import { Text } from "@/components/ui/text";
import { makeStyles, useTheme } from "@/lib/theme";

/** Orbit-lines-and-atoms illustration in accent + border colors. */
export function AtomIllustration({ size = 132 }: { size?: number }) {
	const { colors } = useTheme();
	return (
		<Svg width={size} height={size} viewBox="0 0 120 120" accessibilityElementsHidden>
			<Circle cx={60} cy={60} r={56} fill={colors.accentSoft} opacity={0.55} />
			<G>
				{[0, 60, 120].map((angle) => (
					<Ellipse
						key={angle}
						cx={60}
						cy={60}
						rx={44}
						ry={15}
						stroke={colors.borderStrong}
						strokeWidth={2}
						fill="none"
						transform={`rotate(${angle} 60 60)`}
					/>
				))}
			</G>
			<Circle cx={60} cy={60} r={9} fill={colors.accent} />
			<Circle cx={98} cy={38} r={4.5} fill={colors.accent} />
			<Circle cx={30} cy={89} r={3.5} fill={colors.textSubtle} />
			<Circle cx={47} cy={20} r={3} fill={colors.borderStrong} />
		</Svg>
	);
}

export interface EmptyStateProps {
	title: string;
	body?: string;
	action?: ReactNode;
	secondary?: ReactNode;
	compact?: boolean;
	testID?: string;
}

/** Empty states teach the philosophy: illustration, serif title, body, CTA. */
export function EmptyState({ title, body, action, secondary, compact, testID }: EmptyStateProps) {
	const styles = useStyles();
	return (
		<View style={[styles.wrap, compact && styles.compact]} testID={testID}>
			<AtomIllustration size={compact ? 96 : 132} />
			<Text variant="display" align="center" style={styles.title}>
				{title}
			</Text>
			{body ? (
				<Text tone="muted" align="center" style={styles.body}>
					{body}
				</Text>
			) : null}
			{action ? <View style={styles.action}>{action}</View> : null}
			{secondary}
		</View>
	);
}

const useStyles = makeStyles(() => ({
	wrap: { alignItems: "center", paddingVertical: 32, paddingHorizontal: 12, gap: 8 },
	compact: { paddingVertical: 16 },
	title: { marginTop: 12 },
	body: { maxWidth: 320 },
	action: { marginTop: 16, alignSelf: "stretch", alignItems: "center", gap: 8 },
}));
