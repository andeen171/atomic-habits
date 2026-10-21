import { accountController } from "@/lib/account";
import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { accountErrorKey, deleteErrorKey } from "@atomic/core";
import { useAccountState } from "@atomic/core/react";
import { BadgeCheck, CircleAlert, Download } from "lucide-react";
import { type FormEvent, type RefObject, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "../ui/dialog";
import { Field } from "../ui/field";
import { Spinner } from "./account-ui";
import { GoogleButton } from "./google-button";
import { PasswordInput } from "./password-input";

/**
 * Delete account (Annex C §1.1; D55): an alert dialog that lists what goes,
 * asks what happens on this device ("Keep my data on this device", the
 * default, or "Also erase this device") and confirms with the password, or
 * with a fresh Google sign-in for accounts without one. The delete button
 * stays disabled until confirmed. A refused Stripe cancellation deletes
 * nothing (`account.errors.deleteBilling`). Owner: T5.
 */
export function DeleteAccountDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange(open: boolean): void;
}) {
	const { t } = useT();
	const { account } = useAccountState(accountController);
	const [pending, setPending] = useState(false);
	const passwordRef = useRef<HTMLInputElement>(null);
	const pro = account?.entitlements.plan === "pro" && account.entitlements.source === "stripe";

	return (
		<Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
			<DialogContent
				size="sm"
				role="alertdialog"
				hideClose={pending}
				onOpenAutoFocus={(event) => {
					if (passwordRef.current) {
						event.preventDefault();
						passwordRef.current.focus();
					}
				}}
			>
				<DialogHeader
					title={t("account.deleteTitle")}
					description={
						pro ? `${t("account.deleteBody")} ${t("account.deletePro")}` : t("account.deleteBody")
					}
				/>
				{open ? (
					<DeleteForm
						passwordRef={passwordRef}
						hasPassword={account?.hasPassword !== false}
						pending={pending}
						setPending={setPending}
						onClose={() => onOpenChange(false)}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function DeleteForm({
	passwordRef,
	hasPassword,
	pending,
	setPending,
	onClose,
}: {
	passwordRef: RefObject<HTMLInputElement | null>;
	hasPassword: boolean;
	pending: boolean;
	setPending(pending: boolean): void;
	onClose(): void;
}) {
	const { t } = useT();
	const { server } = useAccountState(accountController);
	const groupId = useId();
	const [erase, setErase] = useState(false);
	const [password, setPassword] = useState("");
	const [google, setGoogle] = useState<{ idToken: string; nonce: string | undefined } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [exporting, setExporting] = useState(false);
	const confirmed = hasPassword ? password.length > 0 : google !== null;

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (pending || !confirmed) return;
		setPending(true);
		setError(null);
		try {
			await accountController.deleteAccount(
				hasPassword
					? { password, eraseLocal: erase }
					: {
							googleIdToken: google?.idToken,
							...(google?.nonce ? { googleNonce: google.nonce } : {}),
							eraseLocal: erase,
						},
			);
			onClose();
			toast.success(t("account.deleted"));
		} catch (caught) {
			setError(t(deleteErrorKey(caught)));
			// A fresh Google confirmation is single-use.
			setGoogle(null);
		} finally {
			setPending(false);
		}
	};

	const exportFirst = async () => {
		setExporting(true);
		try {
			await accountController.exportAccount();
			toast.success(t("account.exportStarted"));
		} catch (caught) {
			toast.error(t(accountErrorKey(caught)));
		} finally {
			setExporting(false);
		}
	};

	return (
		<form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
			<DialogBody className="flex flex-col gap-4 pt-2">
				<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-muted text-small">
					{t("account.deleteExportFirst")}
					<Button
						type="button"
						variant="link"
						size="sm"
						disabled={exporting || pending}
						onClick={() => void exportFirst()}
						className="h-auto"
					>
						{exporting ? <Spinner /> : <Download />}
						{t("account.export")}
					</Button>
				</p>

				<fieldset className="flex flex-col gap-2" aria-describedby={`${groupId}-legend`}>
					<legend id={`${groupId}-legend`} className="mb-2 font-medium text-ink text-small">
						{t("account.deleteThisDevice")}
					</legend>
					<RadioCard
						name={groupId}
						checked={!erase}
						onSelect={() => setErase(false)}
						disabled={pending}
						title={t("account.deleteKeepLocal")}
						hint={t("account.deleteKeepLocalHint")}
					/>
					<RadioCard
						name={groupId}
						checked={erase}
						onSelect={() => setErase(true)}
						disabled={pending}
						title={t("account.deleteEraseLocal")}
						hint={t("account.deleteEraseLocalHint")}
						danger
					/>
				</fieldset>

				{hasPassword ? (
					<Field label={t("account.deleteConfirmPassword")}>
						{(props) => (
							<PasswordInput
								{...props}
								ref={passwordRef}
								autoComplete="current-password"
								value={password}
								disabled={pending}
								onChange={(event) => setPassword(event.target.value)}
							/>
						)}
					</Field>
				) : google ? (
					<output className="flex items-center gap-2 text-ink text-small">
						<BadgeCheck aria-hidden="true" className="size-4 text-success" />
						{t("account.deleteGoogleDone")}
					</output>
				) : (
					<div className="flex flex-col gap-2.5">
						<p className="text-ink text-small">{t("account.deleteReauthGoogle")}</p>
						<GoogleButton
							server={server}
							disabled={pending}
							onCredential={(idToken, nonce) => {
								setGoogle({ idToken, nonce });
								setError(null);
							}}
						/>
					</div>
				)}

				{error ? (
					<p
						role="alert"
						className="flex items-start gap-2.5 rounded-xl bg-danger-soft px-3.5 py-3 text-ink text-small"
					>
						<CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
						{error}
					</p>
				) : null}
			</DialogBody>
			<DialogFooter>
				<Button variant="secondary" disabled={pending} onClick={onClose}>
					{t("common.cancel")}
				</Button>
				<Button type="submit" variant="destructive" disabled={pending || !confirmed}>
					{pending ? <Spinner /> : null}
					{t("account.delete")}
				</Button>
			</DialogFooter>
		</form>
	);
}

function RadioCard({
	name,
	checked,
	onSelect,
	disabled,
	title,
	hint,
	danger,
}: {
	name: string;
	checked: boolean;
	onSelect(): void;
	disabled: boolean;
	title: string;
	hint: string;
	danger?: boolean;
}) {
	return (
		<label
			className={cn(
				"flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors duration-(--atomic-duration-fast) has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
				checked
					? danger
						? "border-danger/60 bg-danger-soft"
						: "border-accent/60 bg-accent-soft/50"
					: "border-line hover:bg-hover",
				disabled && "cursor-default opacity-60",
			)}
		>
			<input
				type="radio"
				name={name}
				checked={checked}
				disabled={disabled}
				onChange={onSelect}
				className={cn("mt-1 size-4 shrink-0", danger ? "accent-danger" : "accent-accent")}
			/>
			<span className="min-w-0">
				<span className="block font-medium text-ink text-small">{title}</span>
				<span className="mt-0.5 block text-ink-muted text-small">{hint}</span>
			</span>
		</label>
	);
}
