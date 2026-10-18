import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** Live "reduce motion" accessibility preference. */
export function useReduceMotion(): boolean {
	const [reduce, setReduce] = useState(false);
	useEffect(() => {
		let active = true;
		AccessibilityInfo.isReduceMotionEnabled()
			.then((value) => {
				if (active) setReduce(value);
			})
			.catch(() => {});
		const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
		return () => {
			active = false;
			sub.remove();
		};
	}, []);
	return reduce;
}
