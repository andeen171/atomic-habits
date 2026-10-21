import { ArrowLeft, ChevronDown, CircleAlert, MailCheck, Server } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import {
	type AuthMode,
	accountController,
	askExistingData,
	endedSessionEmail,
	existingDataFor,
	useAuthSheet,
} from "@/lib/account";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { officialServerUrl, syncController } from "@/lib/sync";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import { type AuthOutcome, accountErrorKey } from "@atomic/core";
import { useSettings } from "@atomic/core/react";
import { type ReactNode, useRef, useState } from "react";
import { type TextInput, View } from "react-native";
import { InlineError } from "./account-ui";
import { serverName, validServerUrl } from "./format";
import { GoogleButton, googleOffered } from "./google-button";
import { PasswordField } from "./password-field";
import { useServerInfo } from "./use-server-info";

/**
 * Sign in / create account / reset password (Annex C §1.1, §5; spec §6),
 * as a bottom sheet:
 * - Sign in and Create account side by side (segmented), Google on top
 *   where the server offers it, then "or" and the email form;
 * - the server line says "Atomic Cloud" (the build's server, D64); a custom
 *   URL lives under the collapsed "Advanced · self-hosting". A build with
 *   no official server shows the URL field directly;
 * - "Forgot password?" only where the server sends email; the reset answer
 *   never says whether the address has an account;
 * - a device with data meeting an account with data asks first (D37,
 *   `MergeSheet`).
 * Errors come from the server's codes (`account.errors.*`), read out at once.
 *
 * Opened with `useAuthSheet().openAuth(mode)`; mounted once by
 * `CloudBanners`. Owner: T5.
 */
export function AuthSheet() {
	const session = useAuthSheet((s) => s.session);
	// A fresh form per opening; the instance stays while the sheet animates out.
	return <AuthSheetForm key={session} />;
}

function AuthSheetForm() {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const settings = useSettings();
	const { open, mode, advanced: startAdvanced, setMode, close } = useAuthSheet();
	const [pending, setPending] = useState(false);
	const custom = settings.serverUrl;
	// No official server in this build (development): the URL field is the only way.
	const urlRequired = !officialServerUrl;
	const [showAdvanced, setShowAdvanced] = useState(
		urlRequired || startAdvanced || (!!custom && custom !== officialServerUrl),
	);
	const [urlText, setUrlText] = useState(custom ?? "");
	const [name, setName] = useState(settings.displayName);
	// "Sign in again" after a session ended: that account's email, ready.
	const [email, setEmail] = useState(() => (mode === "signIn" ? (endedSessionEmail() ?? "") : ""));
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [resetSentTo, setResetSentTo] = useState<string | null>(null);
	const emailRef = useRef<TextInput>(null);
	const passwordRef = useRef<TextInput>(null);
	const urlRef = useRef<TextInput>(null);

	const typedUrl = validServerUrl(urlText);
	const urlInvalid = showAdvanced && urlText.trim() !== "" && !typedUrl;
	const serverUrl = showAdvanced && urlText.trim() ? typedUrl : officialServerUrl;
	// Only while the sheet is up (the controller caches it for an hour anyway).
	const server = useServerInfo(open ? serverUrl : null);
	const info = server.info;
	const showGoogle = mode !== "reset" && googleOffered(info);
	const canReset = info?.features.email === true;

	const onClose = () => {
		if (!pending) close();
	};

	const run = async (action: () => Promise<AuthOutcome>) => {
		setPending(true);
		setError(null);
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			close();
			haptics.success();
			const user = syncController.getState().user;
			showToast(t.t("settings.signedInAs", { email: user?.email ?? email.trim() }), {
				tone: "success",
			});
		};
		// Signed in once the session exists: the first upload carries on in the
		// background (the sync line shows it), so the sheet doesn't wait for it.
		const unsubscribe = syncController.subscribe(() => {
			if (syncController.getState().user) finish();
		});
		try {
			const outcome = await action();
			if (outcome === "signed-in") finish();
			else {
				close();
				showToast(t.t("account.signInCanceled"));
			}
		} catch (caught) {
			if (!done) {
				haptics.warning();
				setError(t.t(accountErrorKey(caught)));
			}
		} finally {
			unsubscribe();
			setPending(false);
		}
	};

	const submit = async () => {
		if (pending) return;
		if (!serverUrl) {
			setShowAdvanced(true);
			setError(t.t("account.serverInvalid"));
			urlRef.current?.focus();
			return;
		}
		if (mode === "reset") {
			setPending(true);
			setError(null);
			try {
				await accountController.requestPasswordReset(serverUrl, email);
				setResetSentTo(email.trim());
				haptics.success();
			} catch (caught) {
				haptics.warning();
				setError(t.t(accountErrorKey(caught)));
			} finally {
				setPending(false);
			}
			return;
		}
		if (mode === "signUp" && password.length < 8) {
			setError(t.t("account.errors.passwordTooShort"));
			passwordRef.current?.focus();
			return;
		}
		const options = { onExistingData: existingDataFor(email) };
		await run(() =>
			mode === "signIn"
				? syncController.signIn(serverUrl, email, password, options)
				: syncController.signUp(serverUrl, name, email, password, options),
		);
	};

	const onGoogle = (idToken: string) => {
		if (!serverUrl || pending) return;
		void run(() =>
			syncController.signInWithGoogle(serverUrl, idToken, undefined, {
				onExistingData: askExistingData,
			}),
		);
	};

	const switchMode = (next: AuthMode) => {
		// A new mode starts without the previous mode's error or reset notice.
		setError(null);
		setResetSentTo(null);
		setMode(next);
	};

	const titles: Record<AuthMode, string> = {
		signIn: t.t("account.signInTitle"),
		signUp: t.t("account.signUpTitle"),
		reset: t.t("account.resetTitle"),
	};
	const hints: Record<AuthMode, string> = {
		signIn: t.t("account.signInHint"),
		signUp: t.t("account.signUpHint"),
		reset: t.t("account.resetHint"),
	};
	const submitLabel =
		mode === "signIn"
			? t.t("settings.signIn")
			: mode === "signUp"
				? t.t("settings.signUp")
				: t.t("account.resetSend");
	const canSubmit =
		email.trim().length > 0 && (mode === "reset" || password.length > 0) && !urlInvalid;

	return (
		<Sheet
			open={open}
			onClose={onClose}
			title={titles[mode]}
			closeButton
			scroll
			testID="auth-sheet"
			footer={
				<Button
					label={submitLabel}
					size="lg"
					loading={pending}
					disabled={!canSubmit}
					onPress={() => void submit()}
					testID="auth-submit"
				/>
			}
		>
			<View style={styles.body}>
				{mode === "reset" ? (
					<Button
						label={t.t("account.backToSignIn")}
						icon={ArrowLeft}
						variant="ghost"
						size="sm"
						disabled={pending}
						onPress={() => switchMode("signIn")}
						style={styles.back}
						testID="auth-back"
					/>
				) : (
					<SegmentedControl<AuthMode>
						value={mode}
						onChange={(next) => switchMode(next)}
						segments={[
							{ value: "signIn", label: t.t("settings.signIn") },
							{ value: "signUp", label: t.t("settings.signUp") },
						]}
						accessibilityLabel={titles[mode]}
					/>
				)}
				<Text variant="small" tone="muted">
					{hints[mode]}
				</Text>

				{showGoogle ? (
					<>
						<GoogleButton server={info} onToken={onGoogle} disabled={pending} />
						<View style={styles.or} accessibilityElementsHidden importantForAccessibility="no">
							<View style={styles.rule} />
							<Text variant="small" tone="muted">
								{t.t("account.or")}
							</Text>
							<View style={styles.rule} />
						</View>
					</>
				) : null}

				{resetSentTo ? (
					<View
						style={[styles.sent, { backgroundColor: colors.successSoft }]}
						accessibilityLiveRegion="polite"
					>
						<MailCheck size={17} color={colors.success} strokeWidth={2.2} />
						<Text variant="small" style={{ flex: 1 }}>
							{t.t("account.resetSent", { email: resetSentTo })}
						</Text>
					</View>
				) : null}

				{mode === "signUp" ? (
					<TextField
						label={t.t("settings.displayName")}
						value={name}
						onChangeText={setName}
						editable={!pending}
						maxLength={80}
						autoComplete="name"
						textContentType="name"
						returnKeyType="next"
						onSubmitEditing={() => emailRef.current?.focus()}
						submitBehavior="submit"
						testID="auth-name"
					/>
				) : null}

				<TextField
					ref={emailRef}
					label={t.t("settings.email")}
					value={email}
					onChangeText={setEmail}
					editable={!pending}
					autoCapitalize="none"
					autoCorrect={false}
					keyboardType="email-address"
					autoComplete={mode === "signUp" ? "email" : "username"}
					textContentType={mode === "signUp" ? "emailAddress" : "username"}
					returnKeyType={mode === "reset" ? "send" : "next"}
					onSubmitEditing={() => (mode === "reset" ? void submit() : passwordRef.current?.focus())}
					submitBehavior={mode === "reset" ? "blurAndSubmit" : "submit"}
					testID="auth-email"
				/>

				{mode === "reset" ? null : (
					<View style={styles.passwordBlock}>
						<PasswordField
							ref={passwordRef}
							label={t.t("settings.password")}
							hint={mode === "signUp" ? t.t("account.passwordHint") : undefined}
							value={password}
							onChangeText={setPassword}
							editable={!pending}
							maxLength={128}
							autoComplete={mode === "signIn" ? "current-password" : "new-password"}
							textContentType={mode === "signIn" ? "password" : "newPassword"}
							returnKeyType="go"
							onSubmitEditing={() => void submit()}
							testID="auth-password"
						/>
						{mode === "signIn" && canReset ? (
							<LinkButton
								label={t.t("account.forgotPassword")}
								onPress={() => switchMode("reset")}
								disabled={pending}
								align="right"
								testID="auth-forgot"
							/>
						) : null}
					</View>
				)}

				{error ? <InlineError>{error}</InlineError> : null}

				<ServerSection
					urlRequired={urlRequired}
					open={showAdvanced}
					onToggle={() => {
						const next = !showAdvanced;
						haptics.selection();
						setShowAdvanced(next);
						if (next) setTimeout(() => urlRef.current?.focus(), 250);
					}}
					label={serverName(serverUrl, officialServerUrl, t.t("account.serverOfficial"))}
					unreachable={server.status === "error"}
				>
					<TextField
						ref={urlRef}
						label={t.t("settings.serverUrl")}
						hint={t.t("account.serverUrlHint")}
						error={urlInvalid ? t.t("account.serverInvalid") : null}
						value={urlText}
						onChangeText={setUrlText}
						editable={!pending}
						placeholder={t.t("settings.serverUrlPlaceholder")}
						autoCapitalize="none"
						autoCorrect={false}
						keyboardType="url"
						textContentType="URL"
						autoFocus={startAdvanced && !urlRequired}
						returnKeyType="done"
						testID="auth-server-url"
					/>
					{officialServerUrl && urlText.trim() ? (
						<LinkButton
							label={t.t("account.serverUseOfficial")}
							disabled={pending}
							onPress={() => {
								setUrlText("");
								setShowAdvanced(false);
							}}
						/>
					) : null}
				</ServerSection>
			</View>
		</Sheet>
	);
}

/** A text button in the accent text color (links inside forms). */
function LinkButton({
	label,
	onPress,
	disabled,
	align = "left",
	testID,
}: {
	label: string;
	onPress(): void;
	disabled?: boolean;
	align?: "left" | "right";
	testID?: string;
}) {
	const styles = useStyles();
	return (
		<PressableScale
			onPress={onPress}
			disabled={disabled}
			hitSlop={8}
			accessibilityRole="button"
			accessibilityLabel={label}
			style={[styles.link, align === "right" && styles.linkRight, disabled && { opacity: 0.5 }]}
			testID={testID}
		>
			<Text variant="small" weight="semibold" tone="accent">
				{label}
			</Text>
		</PressableScale>
	);
}

/** "Server: Atomic Cloud" with the collapsed "Advanced · self-hosting" URL field. */
function ServerSection({
	urlRequired,
	open,
	onToggle,
	label,
	unreachable,
	children,
}: {
	urlRequired: boolean;
	open: boolean;
	onToggle(): void;
	label: string;
	unreachable: boolean;
	children: ReactNode;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	if (urlRequired) {
		return (
			<View style={styles.serverPlain}>
				{children}
				{unreachable ? <Unreachable /> : null}
			</View>
		);
	}
	return (
		<View style={styles.server}>
			<View style={styles.serverHead}>
				<View style={styles.serverName}>
					<Server size={16} color={colors.textMuted} strokeWidth={2} />
					<Text variant="small" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
						{t.t("account.serverLine", { server: label })}
					</Text>
				</View>
				<PressableScale
					onPress={onToggle}
					hitSlop={8}
					accessibilityRole="button"
					accessibilityLabel={t.t("account.serverAdvanced")}
					accessibilityState={{ expanded: open }}
					style={styles.serverToggle}
					testID="auth-advanced"
				>
					<Text variant="small" weight="medium" tone="muted">
						{t.t("account.serverAdvanced")}
					</Text>
					<ChevronDown
						size={16}
						color={colors.textMuted}
						style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}
					/>
				</PressableScale>
			</View>
			{open ? <View style={styles.serverPanel}>{children}</View> : null}
			{unreachable ? <Unreachable /> : null}
		</View>
	);
}

function Unreachable() {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<View style={styles.unreachable} accessibilityLiveRegion="polite">
			<CircleAlert size={16} color={colors.warning} strokeWidth={2.2} />
			<Text variant="small" tone="muted" style={{ flex: 1 }}>
				{t.t("account.errors.network")}
			</Text>
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	body: { gap: 14, paddingBottom: 8 },
	back: { alignSelf: "flex-start", marginLeft: -12 },
	or: { flexDirection: "row", alignItems: "center", gap: 12 },
	rule: { flex: 1, height: 1, backgroundColor: t.colors.border },
	sent: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 10,
		paddingHorizontal: 14,
		paddingVertical: 12,
		borderRadius: t.radii.md,
	},
	passwordBlock: { gap: 8 },
	link: { alignSelf: "flex-start", paddingVertical: 4 },
	linkRight: { alignSelf: "flex-end" },
	server: {
		gap: 12,
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderColor: t.colors.border,
		paddingHorizontal: 14,
		paddingVertical: 12,
	},
	serverPlain: { gap: 8 },
	serverHead: {
		flexDirection: "row",
		flexWrap: "wrap",
		alignItems: "center",
		justifyContent: "space-between",
		columnGap: 12,
		rowGap: 6,
	},
	serverName: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
	serverToggle: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32 },
	serverPanel: { gap: 8 },
	unreachable: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
}));
