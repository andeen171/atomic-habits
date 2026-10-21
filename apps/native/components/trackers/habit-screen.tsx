import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { makeStyles } from "@/lib/theme";
import type { Habit } from "@atomic/core";
import { useText } from "@atomic/core/react";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { View } from "react-native";

/** Back to where the user came from, else the habit page. */
export function closeHabitScreen(habitId: string): void {
	if (router.canGoBack()) router.back();
	else router.replace({ pathname: "/habit/[id]", params: { id: habitId } });
}

/**
 * The full-screen tracker routes (timer, writing pad; Annex K §5.2): the
 * habit's emoji and name under a back button, an optional status on the
 * right, then the screen. Owner: T4.
 */
export function HabitScreen({
	habit,
	habitId,
	right,
	footer,
	keyboard,
	children,
	testID,
}: {
	habit: Habit | undefined;
	habitId: string;
	right?: ReactNode;
	footer?: ReactNode;
	keyboard?: boolean;
	children: ReactNode;
	testID?: string;
}) {
	const t = useT();
	const text = useText();
	const styles = useStyles();
	const name = habit ? text.habit(habit, "name") : t.t("notFound.title");
	return (
		<Screen
			back
			onBack={() => closeHabitScreen(habitId)}
			title={name}
			right={right}
			footer={footer}
			keyboard={keyboard}
			testID={testID}
		>
			{habit ? (
				<View style={styles.heading}>
					<Text style={styles.emoji} allowFontScaling={false}>
						{habit.emoji}
					</Text>
					<Text variant="h2" accessibilityRole="header" numberOfLines={2} style={styles.name}>
						{name}
					</Text>
				</View>
			) : null}
			{children}
		</Screen>
	);
}

/** A habit that's gone or can't use this screen. */
export function ScreenNotice({
	title,
	body,
	habitId,
}: {
	title: string;
	body: string;
	habitId?: string;
}) {
	const t = useT();
	return (
		<EmptyState
			title={title}
			body={body}
			action={
				<Button
					label={habitId ? t.t("habit.viewDetails") : t.t("nav.habits")}
					size="lg"
					onPress={() =>
						habitId
							? router.replace({ pathname: "/habit/[id]", params: { id: habitId } })
							: router.replace("/habits")
					}
				/>
			}
		/>
	);
}

const useStyles = makeStyles(() => ({
	heading: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
	emoji: { fontSize: 24, lineHeight: 30 },
	name: { flexShrink: 1 },
}));
