import { Tabs } from "expo-router/tabs";
import { TabBar } from "@/components/tab-bar";
import { useTheme } from "@/lib/theme";

export default function TabsLayout() {
	const { colors } = useTheme();
	return (
		<Tabs
			tabBar={(props) => <TabBar {...props} />}
			screenOptions={{
				headerShown: false,
				animation: "fade",
				sceneStyle: { backgroundColor: colors.bg },
			}}
		>
			<Tabs.Screen name="index" />
			<Tabs.Screen name="habits" />
			<Tabs.Screen name="tasks" />
			<Tabs.Screen name="you" />
		</Tabs>
	);
}
