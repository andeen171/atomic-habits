import {
	Fragment,
	type ReactNode,
	createContext,
	useContext,
	useId,
	useLayoutEffect,
	useMemo,
	useState,
} from "react";
import { StyleSheet, View } from "react-native";

interface PortalApi {
	set(key: string, node: ReactNode): void;
	remove(key: string): void;
}

const PortalContext = createContext<PortalApi | null>(null);

/**
 * Renders portal content above the navigator (sheets, toasts, confetti) while
 * staying inside every app-level provider and the gesture root.
 */
export function PortalProvider({ children }: { children: ReactNode }) {
	const [items, setItems] = useState<readonly (readonly [string, ReactNode])[]>([]);
	const api = useMemo<PortalApi>(
		() => ({
			set: (key, node) =>
				setItems((prev) => {
					const index = prev.findIndex(([k]) => k === key);
					if (index < 0) return [...prev, [key, node] as const];
					const next = prev.slice();
					next[index] = [key, node] as const;
					return next;
				}),
			remove: (key) => setItems((prev) => prev.filter(([k]) => k !== key)),
		}),
		[],
	);
	return (
		<PortalContext.Provider value={api}>
			{children}
			<View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
				{items.map(([key, node]) => (
					<Fragment key={key}>{node}</Fragment>
				))}
			</View>
		</PortalContext.Provider>
	);
}

export function Portal({ children }: { children: ReactNode }) {
	const api = useContext(PortalContext);
	const key = useId();
	useLayoutEffect(() => {
		api?.set(key, children);
	});
	useLayoutEffect(() => () => api?.remove(key), [api, key]);
	return null;
}
