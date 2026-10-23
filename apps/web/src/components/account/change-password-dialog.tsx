import { accountController } from "@/lib/account";
import { useT } from "@/lib/messages";
import { accountErrorKey } from "@atomic/core";
import { useAccountState } from "@atomic/core/react";
import { CircleAlert } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "../ui/dialog";
import { Field } from "../ui/field";
import { Switch } from "../ui/switch";
import { Spinner } from "./account-ui";
import { PasswordInput } from "./password-input";

/**
 * Change password (Annex C §1.1): current and new password, and "Sign out
 * of other devices" (on by default). With it on, the server ends every
 * session and returns a new token for this one, which is stored before
 * anything else (Annex C §0.9). Owner: T5.
 */
export function ChangePasswordDialog({
	open,
	onOpenChange,
	onChanged,
}: {
	open: boolean;
	onOpenChange(open: boolean): void;
	/** After a change (the device list may have shrunk). */
	onChanged?(): void;
}) {
	const { t } = useT();
	const [pending, setPending] = useState(false);
	return (
		<Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
			<DialogContent size="sm" hideClose={pending}>
				<DialogHeader
					title={t("account.changePassword")}
					description={t("account.changePasswordHint")}
				/>
				{open ? (
					<ChangePasswordForm
						pending={pending}
						setPending={setPending}
						onDone={() => {
							onOpenChange(false);
							onChanged?.();
						}}
						onCancel={() => onOpenChange(false)}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function ChangePasswordForm({
	pending,
	setPending,
	onDone,
	onCancel,
}: {
	pending: boolean;
	setPending(pending: boolean): void;
	onDone(): void;
	onCancel(): void;
}) {
	const { t } = useT();
	const switchId = useId();
	const email = useAccountState(accountController).account?.email ?? "";
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [signOutOthers, setSignOutOthers] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (pending) return;
		if (next.length < 8) {
			setError(t("account.errors.passwordTooShort"));
			return;
		}
		setPending(true);
		setError(null);
		try {
			await accountController.changePassword(current, next, signOutOthers);
			toast.success(t("account.passwordChanged"));
			onDone();
		} catch (caught) {
			setError(t(accountErrorKey(caught)));
		} finally {
			setPending(false);
		}
	};

	return (
		<form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
			<DialogBody className="flex flex-col gap-4 pt-2">
				{/* Lets password managers file the change under the right account. */}
				<input type="text" name="username" autoComplete="username" value={email} hidden readOnly />
				<Field label={t("account.currentPassword")}>
					{(props) => (
						<PasswordInput
							{...props}
							autoComplete="current-password"
							required
							value={current}
							disabled={pending}
							onChange={(event) => setCurrent(event.target.value)}
						/>
					)}
				</Field>
				<Field label={t("account.newPassword")} hint={t("account.passwordHint")}>
					{(props) => (
						<PasswordInput
							{...props}
							autoComplete="new-password"
							required
							minLength={8}
							maxLength={128}
							value={next}
							disabled={pending}
							onChange={(event) => setNext(event.target.value)}
						/>
					)}
				</Field>
				<div className="flex items-start justify-between gap-4 rounded-xl border border-line px-3.5 py-3">
					<label htmlFor={switchId} className="min-w-0">
						<span className="block font-medium text-ink text-small">
							{t("account.signOutOthers")}
						</span>
						<span className="mt-0.5 block text-ink-muted text-small">
							{t("account.signOutOthersHint")}
						</span>
					</label>
					<Switch
						id={switchId}
						checked={signOutOthers}
						disabled={pending}
						onCheckedChange={setSignOutOthers}
						className="mt-0.5"
					/>
				</div>
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
				<Button variant="secondary" disabled={pending} onClick={onCancel}>
					{t("common.cancel")}
				</Button>
				<Button type="submit" disabled={pending || !current || !next}>
					{pending ? <Spinner /> : null}
					{t("account.changePassword")}
				</Button>
			</DialogFooter>
		</form>
	);
}
