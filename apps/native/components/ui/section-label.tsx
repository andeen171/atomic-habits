import type { ReactNode } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { Text } from "./text";

/** Tiny uppercase section label with an optional trailing element. */
export function SectionLabel({
	children,
	right,
	tone,
	style,
}: {
	children: ReactNode;
	right?: ReactNode;
	tone?: "subtle" | "danger" | "accent" | "warning";
	style?: StyleProp<ViewStyle>;
}) {
	return (
		<View
			style={[
				{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					marginBottom: 10,
					minHeight: 20,
				},
				style,
			]}
		>
			<Text variant="label" tone={tone ?? "subtle"} accessibilityRole="header">
				{children}
			</Text>
			{right}
		</View>
	);
}
