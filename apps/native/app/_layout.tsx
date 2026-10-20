import { CloudBanners } from "@/components/account/cloud-banners";
import { Celebration } from "@/components/celebration";
import { GlobalSheets } from "@/components/global-sheets";
import { Logo } from "@/components/logo";
import { PortalProvider } from "@/components/sheet/portal";
import { ToastHost } from "@/components/toast-host";
import { useAppLifecycle } from "@/lib/lifecycle";
import { appMessages } from "@/lib/messages";
import { deviceLocales as readDeviceLocales, store } from "@/lib/store";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { useMonthCelebration } from "@/lib/use-month-celebration";
import { AtomicProvider, useAtomic, useHydrated } from "@atomic/core/react";
import { Geist_400Regular } from "@expo-google-fonts/geist/400Regular";
import { Geist_400Regular_Italic } from "@expo-google-fonts/geist/400Regular_Italic";
import { Geist_500Medium } from "@expo-google-fonts/geist/500Medium";
import { Geist_600SemiBold } from "@expo-google-fonts/geist/600SemiBold";
import { Geist_700Bold } from "@expo-google-fonts/geist/700Bold";
import { InstrumentSerif_400Regular } from "@expo-google-fonts/instrument-serif/400Regular";
import { InstrumentSerif_400Regular_Italic } from "@expo-google-fonts/instrument-serif/400Regular_Italic";
import { useFonts } from "expo-font";
import { NavigationBar } from "expo-navigation-bar";
import {
	DarkTheme,
	DefaultTheme,
	ThemeProvider as NavigationThemeProvider,
	Stack,
} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

SplashScreen.preventAutoHideAsync().catch(() => {});

export { ErrorBoundary } from "expo-router";

export default function RootLayout() {
	const [fontsLoaded, fontError] = useFonts({
		Geist_400Regular,
		Geist_400Regular_Italic,
		Geist_500Medium,
		Geist_600SemiBold,
		Geist_700Bold,
		InstrumentSerif_400Regular,
		InstrumentSerif_400Regular_Italic,
	});
	// The same tags the store resolves the "system" locale with.
	const deviceLocales = useMemo(readDeviceLocales, []);
	return (
		<GestureHandlerRootView style={styles.root}>
			<SafeAreaProvider>
				<AtomicProvider store={store} deviceLocales={deviceLocales} messages={appMessages}>
					<ThemeProvider>
						<AppShell fontsReady={fontsLoaded || Boolean(fontError)} />
					</ThemeProvider>
				</AtomicProvider>
			</SafeAreaProvider>
		</GestureHandlerRootView>
	);
}

function AppShell({ fontsReady }: { fontsReady: boolean }) {
	const hydrated = useHydrated();
	const theme = useTheme();
	const ready = fontsReady && hydrated;

	useEffect(() => {
		SystemUI.setBackgroundColorAsync(theme.colors.bg).catch(() => {});
	}, [theme.colors.bg]);

	useEffect(() => {
		if (ready) SplashScreen.hideAsync().catch(() => {});
	}, [ready]);

	const navigationTheme = useMemo(() => {
		const base = theme.scheme === "dark" ? DarkTheme : DefaultTheme;
		return {
			...base,
			colors: {
				...base.colors,
				primary: theme.colors.accent,
				background: theme.colors.bg,
				card: theme.colors.bg,
				text: theme.colors.text,
				border: theme.colors.border,
				notification: theme.colors.accent,
			},
		};
	}, [theme]);

	const barStyle = theme.scheme === "dark" ? "light" : "dark";

	if (!ready) {
		// Same look as the native splash so there's no flash while data loads.
		return (
			<View style={[styles.splash, { backgroundColor: theme.colors.bg }]}>
				<Logo size={96} />
				<StatusBar style={barStyle} />
			</View>
		);
	}

	return (
		<NavigationThemeProvider value={navigationTheme}>
			<PortalProvider overlay={<ToastHost />}>
				<AppNavigator />
				<CloudBanners />
				<GlobalSheets />
				<Celebration />
			</PortalProvider>
			<StatusBar style={barStyle} />
			<NavigationBar style={barStyle} />
		</NavigationThemeProvider>
	);
}

function AppNavigator() {
	const { colors } = useTheme();
	const onboarded = useAtomic((s) => s.settings.onboarded);
	useAppLifecycle();
	useMonthCelebration();
	return (
		<Stack
			screenOptions={{
				headerShown: false,
				contentStyle: { backgroundColor: colors.bg },
				animation: "slide_from_right",
			}}
		>
			<Stack.Protected guard={onboarded}>
				<Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
				<Stack.Screen name="habit/[id]" />
				<Stack.Screen name="habit/editor" options={{ animation: "slide_from_bottom" }} />
				<Stack.Screen
					name="task/[id]"
					options={{
						presentation: "transparentModal",
						animation: "none",
						contentStyle: { backgroundColor: "transparent" },
					}}
				/>
				<Stack.Screen name="identity" />
				<Stack.Screen name="insights" />
				<Stack.Screen name="scorecard" />
				<Stack.Screen name="settings" />
				<Stack.Screen name="journal/index" />
				<Stack.Screen name="journal/editor" options={{ animation: "slide_from_bottom" }} />
				<Stack.Screen name="habit/timer" options={{ animation: "slide_from_bottom" }} />
				<Stack.Screen name="habit/write" />
				<Stack.Screen name="account" />
			</Stack.Protected>
			<Stack.Protected guard={!onboarded}>
				<Stack.Screen name="onboarding" options={{ animation: "fade" }} />
			</Stack.Protected>
			<Stack.Screen name="+not-found" />
		</Stack>
	);
}

const styles = StyleSheet.create({
	root: { flex: 1 },
	splash: { flex: 1, alignItems: "center", justifyContent: "center" },
});
