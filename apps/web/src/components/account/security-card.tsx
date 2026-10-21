import { accountController } from "@/lib/account";
import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { type SessionInfo, accountErrorKey } from "@atomic/core";
import { useAccountState } from "@atomic/core/react";
import { CircleAlert, KeyRound, LogOut, Monitor, Smartphone, Tablet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsRow, SettingsSection } from "../settings/settings-section";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Notice, Spinner } from "./account-ui";
import { ChangePasswordDialog } from "./change-password-dialog";
import { useNow } from "./format";

/**
 * Account page → Security (Annex C §1.1, §4): change password (accounts
 * with one), and the devices signed in to the account: device, "Active
 * {ago}", a "This device" pill, and a sign-out button named "Sign out
 * {device}" for every other one, plus "Sign out of all other devices".
 * Revoking is immediate; that device is signed out on its next sync.
 * Owner: T5.
 */
export function SecurityCard() {
	const { t } = useT();
	const { account } = useAccountState(accountController);
	const [changing, setChanging] = useState(false);
	const sessions = useSessions();

	return (
		<SettingsSection id="security" title={t("account.security")}>
			{account?.hasPassword !== false ? (
				<SettingsRow
					label={t("account.changePassword")}
					hint={account ? t("account.changePasswordHint") : null}
					stack
				>
					<Button
						variant="secondary"
						size="sm"
						disabled={!account}
						onClick={() => setChanging(true)}
					>
						<KeyRound />
						{t("account.changePassword")}
					</Button>
				</SettingsRow>
			) : (
				<SettingsRow label={t("account.changePassword")} hint={t("account.noPassword")} />
			)}
			<Devices sessions={sessions} />
			<ChangePasswordDialog
				open={changing}
				onOpenChange={setChanging}
				onChanged={() => void sessions.reload()}
			/>
		</SettingsSection>
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
			setList(sessions);
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
	const { t } = useT();
	const now = useNow(60_000);
	const [busy, setBusy] = useState<string | null>(null);
	const others = sessions.list.filter((s) => !s.current);

	const revoke = async (session: SessionInfo) => {
		const name = session.device ?? t("account.unknownDevice");
		setBusy(session.id);
		try {
			await accountController.revokeSession(session.id);
			sessions.remove([session.id]);
			toast.success(t("account.revoked", { device: name }));
		} catch (error) {
			toast.error(t(accountErrorKey(error)));
		} finally {
			setBusy(null);
		}
	};

	const revokeOthers = async () => {
		setBusy("others");
		try {
			const result = await accountController.revokeOtherSessions();
			sessions.remove(others.map((s) => s.id));
			toast.success(t.tp("account.revokedOthers", result.revoked));
		} catch (error) {
			toast.error(t(accountErrorKey(error)));
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className="px-5 py-4">
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<h3 className="font-medium text-ink text-small">{t("account.sessions")}</h3>
				<p className="text-ink-muted text-small">{t("account.sessionsHint")}</p>
			</div>
			{sessions.status === "loading" && !sessions.list.length ? (
				<ul aria-hidden="true" className="mt-3 flex flex-col gap-2">
					{[0, 1].map((i) => (
						<li
							key={i}
							className="flex animate-pulse items-center gap-3 py-2 motion-reduce:animate-none"
						>
							<span className="size-9 rounded-full bg-sunken" />
							<span className="flex flex-1 flex-col gap-1.5">
								<span className="h-3.5 w-1/2 rounded-full bg-sunken" />
								<span className="h-3 w-1/3 rounded-full bg-sunken" />
							</span>
						</li>
					))}
				</ul>
			) : sessions.status === "error" ? (
				<Notice
					tone="warning"
					icon={<CircleAlert />}
					className="mt-3"
					actions={
						<Button variant="secondary" size="sm" onClick={() => void sessions.reload()}>
							{t("account.retry")}
						</Button>
					}
				>
					{t("account.sessionsError")}
				</Notice>
			) : (
				<>
					<ul className="mt-2 divide-y divide-line">
						{sessions.list.map((session) => {
							const Icon = deviceIcon(session.device);
							const name = session.device ?? t("account.unknownDevice");
							return (
								<li key={session.id} className="flex items-center gap-3 py-3">
									<span
										aria-hidden="true"
										className={cn(
											"grid size-9 shrink-0 place-items-center rounded-full",
											session.current ? "bg-accent-soft text-ink" : "bg-sunken text-ink-muted",
										)}
									>
										<Icon className="size-[18px]" />
									</span>
									<div className="min-w-0 flex-1">
										<p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
											<span className="min-w-0 break-words font-medium text-ink text-small">
												{name}
											</span>
											{session.current ? (
												<span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-ink text-tiny">
													{t("account.thisDevice")}
												</span>
											) : null}
										</p>
										<p className="text-ink-muted text-small">
											{t("account.lastActive", { time: t.formatAgo(session.lastActiveAt, now) })}
										</p>
									</div>
									{session.current ? null : (
										<IconButton
											label={t("account.revokeDevice", { device: name })}
											size="lg"
											disabled={busy !== null}
											onClick={() => void revoke(session)}
											className="md:size-9"
										>
											{busy === session.id ? <Spinner /> : <LogOut />}
										</IconButton>
									)}
								</li>
							);
						})}
					</ul>
					{others.length ? (
						<Button
							variant="secondary"
							size="sm"
							disabled={busy !== null}
							onClick={() => void revokeOthers()}
							className="mt-2 h-auto min-h-8 whitespace-normal py-1.5"
						>
							{busy === "others" ? <Spinner /> : <LogOut />}
							{t("account.revokeOthers")}
						</Button>
					) : sessions.status === "ready" ? (
						<p className="mt-1 text-ink-muted text-small">{t("account.onlyThisDevice")}</p>
					) : null}
				</>
			)}
		</div>
	);
}
