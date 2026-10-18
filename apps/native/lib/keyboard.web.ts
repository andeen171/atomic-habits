import { type SharedValue, useSharedValue } from "react-native-reanimated";

/** The browser resizes the viewport itself; nothing to track on web. */
export function useKeyboardHeight(): SharedValue<number> {
	return useSharedValue(0);
}
