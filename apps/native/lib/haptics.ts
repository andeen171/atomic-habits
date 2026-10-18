import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { store } from "./store";

const enabled = () => Platform.OS !== "web" && store.getState().settings.hapticsEnabled;
const ignore = () => {};

/** Haptic feedback that respects `settings.hapticsEnabled` (no-op on web). */
export const haptics = {
	light() {
		if (enabled()) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(ignore);
	},
	medium() {
		if (enabled()) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(ignore);
	},
	selection() {
		if (enabled()) Haptics.selectionAsync().catch(ignore);
	},
	success() {
		if (enabled())
			Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(ignore);
	},
	warning() {
		if (enabled())
			Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(ignore);
	},
};
