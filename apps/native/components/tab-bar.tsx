import type { MessageKey } from "@atomic/core";
import type { BottomTabBarProps } from "expo-router/tabs";
import {
	CircleUserRound,
	ListChecks,
	type LucideIcon,
	Orbit,
	Plus,
	SunMedium,
} from "lucide-react-native";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { ui } from "@/lib/ui-store";

/** Height of the bar above the bottom safe-area inset. */
export const TAB_BAR_HEIGHT = 62;

const TABS: Record<string, { icon: LucideIcon; label: MessageKey }> = {
	index: { icon: SunMedium, label: "nav.today" },
	habits: { icon: Orbit, label: "nav.habits" },
	tasks: { icon: ListChecks, label: "nav.tasks" },
	you: { icon: CircleUserRound, label: "nav.you" },
};

/** Today | Habits | ⊕ | Tasks | You — the ⊕ opens the create sheet. */
export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
	const t = useT();
	const styles = useStyles();
	const routes = state.routes.filter((route) => route.name in TABS);
	const half = Math.ceil(routes.length / 2);

	const renderTab = (route: (typeof routes)[number]) => {
		const index = state.routes.indexOf(route);
		const focused = state.index === index;
		const config = TABS[route.name];
		if (!config) return null;
		return (
			<TabItem
				key={route.key}
				icon={config.icon}
				label={t.t(config.label)}
				focused={focused}
				testID={`tab-${route.name}`}
				onPress={() => {
					const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
					if (!focused && !event.defaultPrevented) {
						haptics.selection();
						navigation.navigate(route.name, route.params);
					}
				}}
			/>
		);
	};

	return (
		<View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
			<View style={styles.row}>
				{routes.slice(0, half).map(renderTab)}
				<View style={styles.centerSlot}>
					<PressableScale
						testID="tab-create"
						scaleTo={0.9}
						onPress={() => {
							haptics.medium();
							ui.openCreate();
						}}
						accessibilityRole="button"
						accessibilityLabel={t.x("create.a11y")}
						style={styles.create}
					>
						<Plus size={26} color="#FFFFFF" strokeWidth={2.4} />
					</PressableScale>
				</View>
				{routes.slice(half).map(renderTab)}
			</View>
		</View>
	);
}

function TabItem({
	icon: Icon,
	label,
	focused,
	onPress,
	testID,
}: {
	icon: LucideIcon;
	label: string;
	focused: boolean;
	onPress: () => void;
	testID: string;
}) {
	const { colors } = useTheme();
	const styles = useStyles();
	const lift = useSharedValue(focused ? 1 : 0);
	useEffect(() => {
		lift.value = withSpring(focused ? 1 : 0, { damping: 15, stiffness: 220 });
	}, [focused, lift]);
	const iconStyle = useAnimatedStyle(() => ({
		transform: [{ translateY: -lift.value * 1.5 }, { scale: 1 + lift.value * 0.06 }],
	}));
	const dotStyle = useAnimatedStyle(() => ({
		opacity: lift.value,
		transform: [{ scale: lift.value }],
	}));
	const color = focused ? colors.text : colors.textSubtle;
	return (
		<Pressable
			testID={testID}
			onPress={onPress}
			style={styles.tab}
			accessibilityRole="tab"
			accessibilityState={{ selected: focused }}
			accessibilityLabel={label}
		>
			<Animated.View style={iconStyle}>
				<Icon size={23} color={color} strokeWidth={focused ? 2.1 : 1.8} />
			</Animated.View>
			<Text variant="tiny" weight={focused ? "semibold" : "medium"} color={color} numberOfLines={1}>
				{label}
			</Text>
			<Animated.View style={[styles.dot, dotStyle]} />
		</Pressable>
	);
}

const useStyles = makeStyles((t) => ({
	bar: {
		backgroundColor: t.colors.surface,
		borderTopWidth: 1,
		borderTopColor: t.colors.border,
	},
	row: {
		height: TAB_BAR_HEIGHT,
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 6,
	},
	tab: {
		flex: 1,
		height: TAB_BAR_HEIGHT,
		alignItems: "center",
		justifyContent: "center",
		gap: 3,
	},
	dot: {
		position: "absolute",
		bottom: 4,
		width: 4,
		height: 4,
		borderRadius: 2,
		backgroundColor: t.colors.accent,
	},
	centerSlot: { width: 72, alignItems: "center", justifyContent: "center" },
	create: {
		width: 52,
		height: 52,
		borderRadius: 26,
		backgroundColor: t.colors.accent,
		alignItems: "center",
		justifyContent: "center",
		shadowColor: t.colors.accent,
		shadowOpacity: t.scheme === "dark" ? 0.4 : 0.35,
		shadowRadius: 12,
		shadowOffset: { width: 0, height: 6 },
		elevation: 6,
	},
}));
