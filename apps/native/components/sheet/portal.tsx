import { useUI } from "@/lib/ui-store";
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
export function PortalProvider({
	children,
	overlay,
}: {
	children: ReactNode;
	/** Drawn above sheets and never hidden from screen readers (toasts). */
	overlay?: ReactNode;
}) {
	// accessibilityViewIsModal is iOS-only: on Android, hide the app behind an open
	// portal sheet from TalkBack so focus can't wander to the screen or tab bar.
	const modal = useUI((s) => s.openPortalSheets > 0);
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
			{/* collapsable={false}: toggling the accessibility flag must never flatten or
			    unflatten this view, which would re-parent (and re-attach) the navigator. */}
			<View
				collapsable={false}
				style={styles.app}
				importantForAccessibility={modal ? "no-hide-descendants" : "auto"}
			>
				{children}
			</View>
			<View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
				{items.map(([key, node]) => (
					<Fragment key={key}>{node}</Fragment>
				))}
			</View>
			{overlay}
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

const styles = StyleSheet.create({ app: { flex: 1 } });
