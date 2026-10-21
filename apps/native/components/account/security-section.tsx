import { CircleAlert, KeyRound, LogOut, Monitor, Smartphone, Tablet } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { SectionLabel } from "@/components/ui/section-label";
import { Text } from "@/components/ui/text";
import { accountController } from "@/lib/account";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import { type SessionInfo, accountErrorKey } from "@atomic/core";
import { useAccountState } from "@atomic/core/react";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import Animated, { FadeOut, LinearTransition } from "react-native-reanimated";
import { CardRow, Divider, Notice } from "./account-ui";
import { ChangePasswordSheet } from "./change-password-sheet";
import { useNow } from "./format";

/**
 * Account → Security (Annex C §1.1, §5): change password (accounts with
 * one), and the devices signed in to the account: device, "Active {ago}",
 * a "This device" pill, and a sign-out button named "Sign out {device}" for
 * every other one, plus "Sign out of all other devices". Revoking is
 * immediate; that device is signed out on its next sync. Owner: T5.
 */
export function SecuritySection() {
	const t = useT();
	const styles = useStyles();
	const { account } = useAccountState(accountController);
	const [changing, setChanging] = useState(false);
	const sessions = useSessions();

	return (
		<>
			<SectionLabel>{t.t("account.security")}</SectionLabel>
			<Card padding={0} style={styles.block} testID="security-section">
				{account?.hasPassword !== false ? (
					<CardRow
						title={t.t("account.changePassword")}
						hint={account ? t.t("account.changePasswordHint") : null}
					>
						<Button
							label={t.t("account.changePassword")}
							icon={KeyRound}
							variant="secondary"
							size="sm"
							disabled={!account}
							onPress={() => setChanging(true)}
							style={styles.start}
							testID="security-change-password"
						/>
					</CardRow>
				) : (
					<CardRow title={t.t("account.changePassword")} hint={t.t("account.noPassword")} />
				)}
				<Divider />
				<Devices sessions={sessions} />
			</Card>
			<ChangePasswordSheet
				open={changing}
				onClose={() => setChanging(false)}
				onChanged={() => void sessions.reload()}
			/>
		</>
	);
}

interface SessionsState {
	status: "loading" | "ready" | "error";
	list: SessionInfo[];
	reload(): Promise<void>;
	remove(ids: string[]): void;
}

function useSessions(): SessionsState {
	const [status, setStatus] = useState<SessionsState["status"]>("loading");
	const [list, setList] = useState<SessionInfo[]>([]);
	const reload = useCallback(async () => {
		setStatus((prev) => (prev === "ready" ? prev : "loading"));
		try {
			const sessions = await accountController.sessions();
			// This device first, then the most recently active.
			setList(
				[...sessions].sort(
					(a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt - a.lastActiveAt,
				),
			);
			setStatus("ready");
		} catch {
			setStatus("error");
		}
	}, []);
	useEffect(() => {
		void reload();
	}, [reload]);
	const remove = useCallback((ids: string[]) => {
		setList((prev) => prev.filter((s) => !ids.includes(s.id)));
	}, []);
	return { status, list, reload, remove };
}

function deviceIcon(device: string | null) {
	if (!device) return Monitor;
	if (/iPad|Tablet/i.test(device)) return Tablet;
	if (/Android|iPhone|iOS|Mobile/i.test(device)) return Smartphone;
	return Monitor;
}

function Devices({ sessions }: { sessions: SessionsState }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const reduceMotion = useReduceMotion();
	const now = useNow(60_000);
	const [busy, setBusy] = useState<string | null>(null);
	const others = sessions.list.filter((s) => !s.current);

	const revoke = async (session: SessionInfo) => {
		const name = session.device ?? t.t("account.unknownDevice");
		haptics.medium();
		setBusy(session.id);
		try {
			await accountController.revokeSession(session.id);
			sessions.remove([session.id]);
			showToast(t.t("account.revoked", { device: name }), { tone: "success" });
		} catch (error) {
			showToast(t.t(accountErrorKey(error)), { tone: "danger" });
		} finally {
			setBusy(null);
		}
	};

	const revokeOthers = async () => {
		haptics.medium();
		setBusy("others");
		try {
			const result = await accountController.revokeOtherSessions();
			sessions.remove(others.map((s) => s.id));
			showToast(t.tp("account.revokedOthers", result.revoked), { tone: "success" });
		} catch (error) {
			showToast(t.t(accountErrorKey(error)), { tone: "danger" });
		} finally {
			setBusy(null);
		}
	};

	return (
		<View style={styles.devices}>
			<View style={styles.devicesHead}>
				<Text weight="medium">{t.t("account.sessions")}</Text>
				<Text variant="small" tone="muted">
					{t.t("account.sessionsHint")}
				</Text>
			</View>
			{sessions.status === "loading" && !sessions.list.length ? (
				<View style={styles.loading} accessibilityElementsHidden>
					<ActivityIndicator color={colors.textMuted} />
				</View>
			) : sessions.status === "error" ? (
				<Notice
					tone="warning"
					icon={CircleAlert}
					actions={
						<Button
							label={t.t("account.retry")}
							variant="secondary"
							size="sm"
							onPress={() => void sessions.reload()}
						/>
					}
				>
					{t.t("account.sessionsError")}
				</Notice>
			) : (
				<>
					<View>
						{sessions.list.map((session, index) => {
							const Icon = deviceIcon(session.device);
							const name = session.device ?? t.t("account.unknownDevice");
							const active = t.t("account.lastActive", {
								time: t.formatAgo(session.lastActiveAt, now),
							});
							return (
								<Animated.View
									key={session.id}
									exiting={reduceMotion ? undefined : FadeOut.duration(160)}
									layout={reduceMotion ? undefined : LinearTransition.duration(200)}
								>
									{index > 0 ? <Divider inset={50} /> : null}
									<View style={styles.device} testID={`device-${session.id}`}>
										<View
											style={[
												styles.deviceIcon,
												{
													backgroundColor: session.current ? colors.accentSoft : colors.sunken,
												},
											]}
										>
											<Icon
												size={18}
												color={session.current ? colors.text : colors.textMuted}
												strokeWidth={1.9}
											/>
										</View>
										<View
											style={styles.deviceText}
											accessible
											accessibilityLabel={[
												name,
												session.current ? t.t("account.thisDevice") : null,
												active,
											]
												.filter(Boolean)
												.join(", ")}
										>
											<Text variant="small" weight="semibold">
												{name}
											</Text>
											<View style={styles.deviceMeta}>
												{session.current ? (
													<View style={[styles.pill, { backgroundColor: colors.accentSoft }]}>
														<Text variant="tiny" weight="semibold">
															{t.t("account.thisDevice")}
														</Text>
													</View>
												) : null}
												<Text variant="small" tone="muted">
													{active}
												</Text>
											</View>
										</View>
										{session.current ? null : busy === session.id ? (
											<View style={styles.revokeBusy}>
												<ActivityIndicator size="small" color={colors.textMuted} />
											</View>
										) : (
											<IconButton
												icon={LogOut}
												size={40}
												iconSize={18}
												color={colors.textMuted}
												disabled={busy !== null}
												accessibilityLabel={t.t("account.revokeDevice", { device: name })}
												onPress={() => void revoke(session)}
												testID={`device-revoke-${session.id}`}
											/>
										)}
									</View>
								</Animated.View>
							);
						})}
					</View>
					{others.length ? (
						<Button
							label={t.t("account.revokeOthers")}
							icon={LogOut}
							variant="secondary"
							size="sm"
							loading={busy === "others"}
							disabled={busy !== null && busy !== "others"}
							onPress={() => void revokeOthers()}
							style={styles.start}
							testID="devices-revoke-others"
						/>
					) : sessions.status === "ready" ? (
						<Text variant="small" tone="muted">
							{t.t("account.onlyThisDevice")}
						</Text>
					) : null}
				</>
			)}
		</View>
	);
}

const useStyles = makeStyles(() => ({
	block: { marginBottom: 24 },
	start: { alignSelf: "flex-start" },
	devices: { padding: 16, gap: 10 },
	devicesHead: { gap: 2 },
	loading: { paddingVertical: 16, alignItems: "center" },
	device: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
	deviceIcon: {
		width: 38,
		height: 38,
		borderRadius: 19,
		alignItems: "center",
		justifyContent: "center",
	},
	deviceText: { flex: 1, gap: 3 },
	deviceMeta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
	pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
	revokeBusy: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
}));
