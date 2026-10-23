import {
	type AuthMode,
	accountController,
	askExistingData,
	endedSessionEmail,
	existingDataFor,
	useAuthDialog,
} from "@/lib/account";
import { useT } from "@/lib/messages";
import { officialServerUrl, syncController } from "@/lib/sync";
import { cn } from "@/lib/utils";
import { type AuthOutcome, accountErrorKey } from "@atomic/core";
import { useSettings } from "@atomic/core/react";
import { ChevronDown, CircleAlert, MailCheck, Server } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "../ui/dialog";
import { Field, Input } from "../ui/field";
import { Spinner } from "./account-ui";
import { serverName } from "./format";
import { GoogleButton, googleAvailable } from "./google-button";
import { PasswordInput } from "./password-input";
import { useServerInfo, validServerUrl } from "./use-server-info";

/**
 * Sign in / create account / reset password (Annex C §1.1, §4; spec §5.9):
 * - Google at the top when the server offers it here, then "or" and the
 *   email form.
 * - The server line says "Atomic Cloud" (the build's server, D64); a custom
 *   URL lives under the collapsed "Advanced · self-hosting". A build with no
 *   official server shows the URL field directly.
 * - "Forgot password?" only where the server sends email; the reset answer
 *   never says whether the address has an account.
 * - A device with data meeting an account with data asks first (D37,
 *   `MergeDialog`).
 * Errors come from the server's codes (`account.errors.*`) in an alert.
 *
 * Opened through `useAuthDialog().openAuth(mode)`. Owner: T5.
 */
export function AuthDialog() {
	const { t } = useT();
	const { open, mode, advanced, session, setMode, close } = useAuthDialog();
	const [pending, setPending] = useState(false);

	const titles: Record<AuthMode, string> = {
		signIn: t("account.signInTitle"),
		signUp: t("account.signUpTitle"),
		reset: t("account.resetTitle"),
	};
	const hints: Record<AuthMode, string> = {
		signIn: t("account.signInHint"),
		signUp: t("account.signUpHint"),
		reset: t("account.resetHint"),
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next && !pending) close();
			}}
		>
			<DialogContent
				size="sm"
				hideClose={pending}
				aria-busy={pending || undefined}
				onOpenAutoFocus={(event) => {
					// "Use a different server" lands on the server URL field.
					const target = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
						"[data-autofocus]",
					);
					if (!target) return;
					event.preventDefault();
					target.focus();
				}}
			>
				<DialogHeader title={titles[mode]} description={hints[mode]} />
				{/* A fresh form per opening; it stays mounted while the dialog animates out. */}
				<AuthForm
					key={session}
					mode={mode}
					startAdvanced={advanced}
					pending={pending}
					setPending={setPending}
					setMode={setMode}
					close={close}
				/>
			</DialogContent>
		</Dialog>
	);
}

function AuthForm({
	mode,
	startAdvanced,
	pending,
	setPending,
	setMode,
	close,
}: {
	mode: AuthMode;
	startAdvanced: boolean;
	pending: boolean;
	setPending(pending: boolean): void;
	setMode(mode: AuthMode): void;
	close(): void;
}) {
	const { t } = useT();
	const settings = useSettings();
	const advancedId = useId();
	const errorId = useId();
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
	const emailRef = useRef<HTMLInputElement>(null);
	const urlRef = useRef<HTMLInputElement>(null);

	const typedUrl = validServerUrl(urlText);
	const urlInvalid = showAdvanced && urlText.trim() !== "" && !typedUrl;
	const serverUrl = showAdvanced && urlText.trim() ? typedUrl : officialServerUrl;
	const server = useServerInfo(serverUrl);
	const info = server.info;
	const google = googleAvailable(info);

	const run = async (action: () => Promise<AuthOutcome>) => {
		setPending(true);
		setError(null);
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			close();
			const user = syncController.getState().user;
			toast.success(t("settings.signedInAs", { email: user?.email ?? email.trim() }));
		};
		// Signed in once the session exists: the first upload carries on in the
		// background (the sync line shows it), so the dialog doesn't wait for it.
		const unsubscribe = syncController.subscribe(() => {
			if (syncController.getState().user) finish();
		});
		try {
			const outcome = await action();
			if (outcome === "signed-in") finish();
			else {
				close();
				toast(t("account.signInCanceled"));
			}
		} catch (caught) {
			if (!done) setError(t(accountErrorKey(caught)));
		} finally {
			unsubscribe();
			setPending(false);
		}
	};

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (pending) return;
		if (!serverUrl) {
			setShowAdvanced(true);
			setError(t("account.serverInvalid"));
			urlRef.current?.focus();
			return;
		}
		if (mode === "reset") {
			setPending(true);
			setError(null);
			try {
				await accountController.requestPasswordReset(serverUrl, email);
				setResetSentTo(email.trim());
			} catch (caught) {
				setError(t(accountErrorKey(caught)));
			} finally {
				setPending(false);
			}
			return;
		}
		const options = { onExistingData: existingDataFor(email) };
		await run(() =>
			mode === "signIn"
				? syncController.signIn(serverUrl, email, password, options)
				: syncController.signUp(serverUrl, name, email, password, options),
		);
	};

	const onGoogle = (idToken: string, nonce: string | undefined) => {
		if (!serverUrl || pending) return;
		void run(() =>
			syncController.signInWithGoogle(serverUrl, idToken, nonce, {
				onExistingData: askExistingData,
			}),
		);
	};

	const switchMode = (next: AuthMode) => {
		// A new mode starts without the previous mode's error or reset notice.
		setError(null);
		setResetSentTo(null);
		setMode(next);
		requestAnimationFrame(() => emailRef.current?.focus());
	};

	const officialLabel = t("account.serverOfficial");
	const showGoogle = mode !== "reset" && !!google;
	const canReset = info?.features.email === true;

	return (
		<form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
			<DialogBody className="flex flex-col gap-4 pt-2">
				{showGoogle ? (
					<>
						<GoogleButton server={info} onCredential={onGoogle} disabled={pending} />
						<div className="flex items-center gap-3 text-ink-muted text-small" aria-hidden="true">
							<span className="h-px flex-1 bg-line" />
							{t("account.or")}
							<span className="h-px flex-1 bg-line" />
						</div>
					</>
				) : null}

				{resetSentTo ? (
					<output className="flex items-start gap-2.5 rounded-xl bg-success-soft px-3.5 py-3 text-ink text-small">
						<MailCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
						{t("account.resetSent", { email: resetSentTo })}
					</output>
				) : null}

				{mode === "signUp" ? (
					<Field label={t("settings.displayName")}>
						{(props) => (
							<Input
								{...props}
								autoComplete="name"
								maxLength={80}
								value={name}
								disabled={pending}
								onChange={(event) => setName(event.target.value)}
							/>
						)}
					</Field>
				) : null}

				<Field label={t("settings.email")}>
					{(props) => (
						<Input
							{...props}
							ref={emailRef}
							type="email"
							inputMode="email"
							autoComplete={mode === "signUp" ? "email" : "username"}
							autoCapitalize="off"
							spellCheck={false}
							required
							value={email}
							disabled={pending}
							aria-describedby={error ? errorId : props["aria-describedby"]}
							onChange={(event) => setEmail(event.target.value)}
						/>
					)}
				</Field>

				{mode === "reset" ? null : (
					<div className="flex flex-col gap-1.5">
						<Field
							label={t("settings.password")}
							hint={mode === "signUp" ? t("account.passwordHint") : undefined}
						>
							{(props) => (
								<PasswordInput
									{...props}
									autoComplete={mode === "signIn" ? "current-password" : "new-password"}
									required
									minLength={mode === "signUp" ? 8 : undefined}
									maxLength={128}
									value={password}
									disabled={pending}
									onChange={(event) => setPassword(event.target.value)}
								/>
							)}
						</Field>
						{mode === "signIn" && canReset ? (
							<button
								type="button"
								onClick={() => switchMode("reset")}
								className="self-end rounded-sm font-medium text-accent-text text-small underline-offset-4 hover:underline"
							>
								{t("account.forgotPassword")}
							</button>
						) : null}
					</div>
				)}

				{error ? (
					<p
						id={errorId}
						role="alert"
						className="flex items-start gap-2.5 rounded-xl bg-danger-soft px-3.5 py-3 text-ink text-small"
					>
						<CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
						{error}
					</p>
				) : null}

				<ServerSection
					urlRequired={urlRequired}
					open={showAdvanced}
					onToggle={() => {
						const next = !showAdvanced;
						setShowAdvanced(next);
						if (next) requestAnimationFrame(() => urlRef.current?.focus());
					}}
					panelId={advancedId}
					label={serverName(serverUrl, officialServerUrl, officialLabel)}
					unreachable={server.status === "error"}
				>
					<Field
						label={t("settings.serverUrl")}
						hint={t("account.serverUrlHint")}
						error={urlInvalid ? t("account.serverInvalid") : undefined}
					>
						{(props) => (
							<Input
								{...props}
								ref={urlRef}
								data-autofocus={startAdvanced && !urlRequired ? "" : undefined}
								type="url"
								inputMode="url"
								autoComplete="url"
								autoCapitalize="off"
								spellCheck={false}
								value={urlText}
								disabled={pending}
								placeholder={t("settings.serverUrlPlaceholder")}
								onChange={(event) => setUrlText(event.target.value)}
							/>
						)}
					</Field>
					{officialServerUrl && urlText.trim() ? (
						<button
							type="button"
							disabled={pending}
							onClick={() => {
								setUrlText("");
								setShowAdvanced(false);
							}}
							className="self-start rounded-sm font-medium text-accent-text text-small underline-offset-4 hover:underline"
						>
							{t("account.serverUseOfficial")}
						</button>
					) : null}
				</ServerSection>
			</DialogBody>

			<DialogFooter className="sm:justify-between">
				<ModeSwitch mode={mode} disabled={pending} onSwitch={switchMode} />
				<Button type="submit" disabled={pending} className="w-full sm:w-auto">
					{pending ? <Spinner /> : null}
					{mode === "signIn"
						? t("settings.signIn")
						: mode === "signUp"
							? t("settings.signUp")
							: t("account.resetSend")}
				</Button>
			</DialogFooter>
		</form>
	);
}

function ModeSwitch({
	mode,
	disabled,
	onSwitch,
}: {
	mode: AuthMode;
	disabled: boolean;
	onSwitch(mode: AuthMode): void;
}) {
	const { t } = useT();
	const linkClass =
		"rounded-sm font-medium text-accent-text underline-offset-4 hover:underline disabled:opacity-50";
	if (mode === "reset") {
		return (
			<button
				type="button"
				disabled={disabled}
				onClick={() => onSwitch("signIn")}
				className={cn(linkClass, "self-center text-small")}
			>
				{t("account.backToSignIn")}
			</button>
		);
	}
	return (
		<p className="text-center text-ink-muted text-small sm:text-left">
			{mode === "signIn" ? t("settings.noAccount") : t("settings.haveAccount")}{" "}
			<button
				type="button"
				disabled={disabled}
				onClick={() => onSwitch(mode === "signIn" ? "signUp" : "signIn")}
				className={linkClass}
			>
				{mode === "signIn" ? t("settings.signUp") : t("settings.signIn")}
			</button>
		</p>
	);
}

/** "Server: Atomic Cloud" with the collapsed "Advanced · self-hosting" URL field. */
function ServerSection({
	urlRequired,
	open,
	onToggle,
	panelId,
	label,
	unreachable,
	children,
}: {
	urlRequired: boolean;
	open: boolean;
	onToggle(): void;
	panelId: string;
	label: string;
	unreachable: boolean;
	children: ReactNode;
}) {
	const { t } = useT();
	if (urlRequired) {
		return (
			<div className="flex flex-col gap-2">
				{children}
				{unreachable ? <Unreachable /> : null}
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-3 rounded-xl border border-line px-3.5 py-3">
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
				<span className="flex min-w-0 items-center gap-2 text-ink-muted text-small">
					<Server aria-hidden="true" className="size-4 shrink-0" />
					<span className="min-w-0 truncate">{t("account.serverLine", { server: label })}</span>
				</span>
				<button
					type="button"
					aria-expanded={open}
					aria-controls={panelId}
					onClick={onToggle}
					className="inline-flex items-center gap-1 rounded-sm font-medium text-ink-muted text-small hover:text-ink"
				>
					{t("account.serverAdvanced")}
					<ChevronDown
						aria-hidden="true"
						className={cn(
							"size-4 transition-transform duration-(--atomic-duration-fast) motion-reduce:transition-none",
							open && "rotate-180",
						)}
					/>
				</button>
			</div>
			<div id={panelId} hidden={!open} className="flex flex-col gap-2">
				{children}
			</div>
			{unreachable ? <Unreachable /> : null}
		</div>
	);
}

function Unreachable() {
	const { t } = useT();
	return (
		<p className="flex items-start gap-2 text-ink-muted text-small">
			<CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
			{t("account.errors.network")}
		</p>
	);
}
