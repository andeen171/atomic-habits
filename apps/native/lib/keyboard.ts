import { type SharedValue, useAnimatedKeyboard } from "react-native-reanimated";

/** Live software-keyboard height on the UI thread. */
export function useKeyboardHeight(): SharedValue<number> {
	return useAnimatedKeyboard().height;
}
