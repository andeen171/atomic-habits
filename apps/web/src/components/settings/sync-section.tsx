import { useT } from "@/lib/messages";
import { syncController } from "@/lib/sync";
import { cn } from "@/lib/utils";
import { RemoteError } from "@atomic/core";
import { useSettings, useSyncState } from "@atomic/core/react";
import { Cloud, CloudAlert, LogOut, RefreshCw } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "../ui/button";
import { Field, Input } from "../ui/field";
import { SegmentedControl } from "../ui/segmented";
import { SettingsSection } from "./settings-section";

type AuthMode = "signIn" | "signUp";

/** Settings → Sync (beta): sign in to a self-hosted Atomic server. */
export function SyncSection() {
	const { t } = useT();
	const state = useSyncState(syncController);
	return (
		<SettingsSection
			id="sync"
			title={t("settings.sync")}
			description={t("settings.syncHint")}
			badge={
				<span className="rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-[10px] text-ink uppercase tracking-wider dark:text-accent-text">
					{t("settings.syncBeta")}
				</span>
			}
		>
			{state.user ? <SignedIn /> : <SignInForm />}
		</SettingsSection>
	);
}

function SignedIn() {
	const { t, at } = useT();
	const state = useSyncState(syncController);
	const syncing = state.status === "syncing";
	const Icon = state.status === "error" ? CloudAlert : Cloud;
	return (
		<div className="flex flex-col gap-4 px-5 py-4">
			<div className="flex items-start gap-3">
				<span
					className={cn(
						"grid size-10 shrink-0 place-items-center rounded-full",
						state.status === "error"
							? "bg-warning-soft text-warning"
							: "bg-success-soft text-success",
					)}
				>
					<Icon className="size-5" />
				</span>
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-ink text-small">
						{t("settings.signedInAs", { email: state.user?.email ?? "" })}
					</p>
					<p className="truncate text-ink-subtle text-small">{state.serverUrl}</p>
					<p className="mt-1 text-ink-muted text-small" aria-live="polite">
						{syncing
							? t("settings.syncing")
							: state.lastSyncedAt
								? t("settings.lastSynced", { time: t.formatAgo(state.lastSyncedAt) })
								: t("settings.neverSynced")}
					</p>
				</div>
			</div>
			{state.error ? (
				<p role="alert" className="rounded-md bg-warning-soft px-3 py-2 text-ink text-small">
					{state.error === "auth" ? t("settings.authError") : t("settings.syncError")}
					<span className="sr-only"> {at("sync.error")}</span>
				</p>
			) : null}
			<div className="flex flex-wrap gap-2">
				<Button
					variant="secondary"
					size="sm"
					disabled={syncing}
					onClick={() => void syncController.syncNow()}
				>
					<RefreshCw className={cn(syncing && "animate-spin")} />
					{syncing ? t("settings.syncing") : t("settings.syncNow")}
				</Button>
				<Button variant="ghost" size="sm" onClick={() => void syncController.signOut()}>
					<LogOut />
					{t("settings.signOut")}
				</Button>
			</div>
		</div>
	);
}

function SignInForm() {
	const { t, at } = useT();
	const settings = useSettings();
	const [mode, setMode] = useState<AuthMode>("signIn");
	const [serverUrl, setServerUrl] = useState(
		settings.serverUrl ?? import.meta.env.VITE_SERVER_URL ?? "",
	);
	const [name, setName] = useState(settings.displayName);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<"auth" | "sync" | null>(null);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setPending(true);
		setError(null);
		try {
			if (mode === "signIn") await syncController.signIn(serverUrl, email, password);
			else await syncController.signUp(serverUrl, name, email, password);
		} catch (caught) {
			const status = caught instanceof RemoteError ? caught.status : 0;
			setError(status >= 400 && status < 500 ? "auth" : "sync");
		} finally {
			setPending(false);
		}
	};

	return (
		<form onSubmit={submit} className="flex flex-col gap-4 px-5 py-5">
			<p className="text-ink-muted text-small">{at("settings.syncSignedOut")}</p>
			<Field label={t("settings.serverUrl")}>
				{(props) => (
					<Input
						{...props}
						type="url"
						inputMode="url"
						autoComplete="url"
						required
						value={serverUrl}
						placeholder={t("settings.serverUrlPlaceholder")}
						onChange={(event) => setServerUrl(event.target.value)}
					/>
				)}
			</Field>
			<SegmentedControl<AuthMode>
				label={`${t("settings.signIn")} / ${t("settings.signUp")}`}
				value={mode}
				onChange={setMode}
				options={[
					{ value: "signIn", label: t("settings.signIn") },
					{ value: "signUp", label: t("settings.signUp") },
				]}
				className="self-start"
			/>
			{mode === "signUp" ? (
				<Field label={t("settings.displayName")}>
					{(props) => (
						<Input
							{...props}
							autoComplete="name"
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					)}
				</Field>
			) : null}
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<Field label={t("settings.email")}>
					{(props) => (
						<Input
							{...props}
							type="email"
							autoComplete="email"
							required
							value={email}
							onChange={(event) => setEmail(event.target.value)}
						/>
					)}
				</Field>
				<Field label={t("settings.password")}>
					{(props) => (
						<Input
							{...props}
							type="password"
							autoComplete={mode === "signIn" ? "current-password" : "new-password"}
							required
							minLength={8}
							value={password}
							onChange={(event) => setPassword(event.target.value)}
						/>
					)}
				</Field>
			</div>
			{error ? (
				<p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-ink text-small">
					{error === "auth" ? t("settings.authError") : t("settings.syncError")}
				</p>
			) : null}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<button
					type="button"
					onClick={() => setMode(mode === "signIn" ? "signUp" : "signIn")}
					className="text-ink-muted text-small hover:text-ink"
				>
					{mode === "signIn" ? t("settings.noAccount") : t("settings.haveAccount")}{" "}
					<span className="font-medium text-accent-text">
						{mode === "signIn" ? t("settings.signUp") : t("settings.signIn")}
					</span>
				</button>
				<Button type="submit" disabled={pending}>
					{pending ? <RefreshCw className="animate-spin" /> : null}
					{mode === "signIn" ? t("settings.signIn") : t("settings.signUp")}
				</Button>
			</div>
			<p className="text-ink-subtle text-tiny">{at("settings.syncFormHint")}</p>
		</form>
	);
}
