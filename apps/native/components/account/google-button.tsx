import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { GoogleSignInError, googleAvailable, googleIdToken } from "@/lib/google";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import type { ServerInfo } from "@atomic/core";
import { useState } from "react";
import { ActivityIndicator, type StyleProp, View, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";

/** Google is offered when the server has it and this build links the native module. */
export function googleOffered(server: ServerInfo | null | undefined): boolean {
	return !!server?.features.google?.webClientId && googleAvailable();
}

/**
 * "Continue with Google" (Annex C §1.1, §5): Google's account chooser, then
 * the fresh ID token goes to `onToken` (sign in, or the re-auth before a
 * delete). Renders nothing where Google isn't offered. Owner: T5.
 */
export function GoogleButton({
	server,
	onToken,
	disabled,
	label,
	style,
}: {
	server: ServerInfo | null | undefined;
	onToken(idToken: string): void;
	disabled?: boolean;
	/** Defaults to "Continue with Google". */
	label?: string;
	style?: StyleProp<ViewStyle>;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const [busy, setBusy] = useState(false);
	const clientId = server?.features.google?.webClientId;
	if (!clientId || !googleAvailable()) return null;
	const text = label ?? t.t("account.continueGoogle");

	const press = async () => {
		if (busy || disabled) return;
		haptics.selection();
		setBusy(true);
		try {
			const token = await googleIdToken(clientId);
			if (token) onToken(token);
		} catch (error) {
			haptics.warning();
			showToast(
				t.t(
					error instanceof GoogleSignInError && error.reason === "play-services"
						? "account.errors.googlePlayServices"
						: "account.errors.generic",
				),
				{ tone: "danger" },
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<PressableScale
			onPress={() => void press()}
			disabled={disabled || busy}
			accessibilityRole="button"
			accessibilityLabel={text}
			accessibilityState={{ disabled: Boolean(disabled), busy }}
			style={[styles.button, { opacity: disabled ? 0.45 : 1 }, style]}
			testID="google-button"
		>
			<View style={styles.logo}>
				{busy ? <ActivityIndicator size="small" color={colors.textMuted} /> : <GoogleLogo />}
			</View>
			<Text weight="semibold" numberOfLines={1} style={styles.label}>
				{text}
			</Text>
		</PressableScale>
	);
}

/** Google's "G" (brand colors, as Google's sign-in guidelines ask). */
function GoogleLogo({ size = 18 }: { size?: number }) {
	return (
		<Svg width={size} height={size} viewBox="0 0 48 48">
			<Path
				fill="#EA4335"
				d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
			/>
			<Path
				fill="#4285F4"
				d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
			/>
			<Path
				fill="#FBBC05"
				d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
			/>
			<Path
				fill="#34A853"
				d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
			/>
		</Svg>
	);
}

const useStyles = makeStyles((t) => ({
	button: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 10,
		minHeight: 50,
		paddingHorizontal: 20,
		borderRadius: 999,
		borderWidth: 1,
		borderColor: t.colors.borderStrong,
		backgroundColor: t.colors.surface,
	},
	logo: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
	label: { flexShrink: 1 },
}));
