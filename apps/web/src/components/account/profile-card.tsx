import { accountController } from "@/lib/account";
import { useT } from "@/lib/messages";
import { syncController } from "@/lib/sync";
import { accountErrorKey } from "@atomic/core";
import { useAccountState, useLocale, useSyncState } from "@atomic/core/react";
import { BadgeCheck, CircleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { SettingsSection } from "../settings/settings-section";
import { Input } from "../ui/field";
import { Avatar, Spinner } from "./account-ui";
import { formatDate } from "./format";

/**
 * Account page → Profile (Annex C §1.1, §4): the account name, edited in
 * place (saved on blur or Enter; Escape restores it), the email with its
 * verified state, sign-in methods and the account's age (the "Verify your
 * email" notice sits at the top of the page). The account name
 * is separate from the name this device greets you with. Owner: T5.
 */
export function ProfileCard() {
	const { t } = useT();
	const locale = useLocale();
	const sync = useSyncState(syncController);
	const { account, server } = useAccountState(accountController);
	const nameId = useId();
	const hintId = useId();
	const user = sync.user;
	const savedName = account?.name ?? user?.name ?? "";
	const [name, setName] = useState(savedName);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const editing = useRef(false);

	useEffect(() => {
		if (!editing.current) setName(savedName);
	}, [savedName]);

	if (!user) return null;
	const email = account?.email ?? user.email;
	const verified = account?.emailVerified ?? user.emailVerified ?? null;

	const save = async () => {
		editing.current = false;
		const next = name.trim();
		if (!next || next === savedName) {
			setName(savedName);
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await accountController.updateName(next);
			toast.success(t("common.saved"));
		} catch (caught) {
			setError(t(accountErrorKey(caught)));
		} finally {
			setSaving(false);
		}
	};

	const providers = account?.providers ?? [];
	const methods = [
		...(account?.hasPassword ? [t("account.providerPassword")] : []),
		...(providers.includes("google") ? [t("account.providerGoogle")] : []),
	];

	return (
		<SettingsSection id="profile" title={t("settings.profile")}>
			<div className="flex flex-col gap-5 px-5 py-5">
				<div className="flex items-center gap-4">
					<Avatar name={name || savedName} email={email} size="lg" />
					<div className="min-w-0 flex-1">
						<label htmlFor={nameId} className="font-medium text-ink text-small">
							{t("settings.displayName")}
						</label>
						<div className="relative mt-1.5 sm:max-w-sm">
							<Input
								id={nameId}
								value={name}
								maxLength={80}
								autoComplete="name"
								aria-describedby={hintId}
								aria-invalid={error ? true : undefined}
								onChange={(event) => {
									editing.current = true;
									setName(event.target.value);
								}}
								onBlur={() => void save()}
								onKeyDown={(event) => {
									if (event.key === "Enter") event.currentTarget.blur();
									if (event.key === "Escape" && name !== savedName) {
										event.preventDefault();
										event.stopPropagation();
										editing.current = false;
										setName(savedName);
									}
								}}
								className="pr-10"
							/>
							{saving ? (
								<Spinner className="-translate-y-1/2 absolute top-1/2 right-3 size-4 text-ink-muted" />
							) : null}
						</div>
						<p id={hintId} className="mt-1 text-ink-muted text-small">
							{error ?? t("account.nameHint")}
						</p>
					</div>
				</div>

				<dl className="grid gap-x-6 gap-y-4 border-line border-t pt-4 text-small sm:grid-cols-2">
					<div className="min-w-0">
						<dt className="text-ink-muted">{t("settings.email")}</dt>
						<dd className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ink">
							<span className="min-w-0 break-all font-medium">{email}</span>
							{verified === true ? (
								<span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 font-medium text-ink text-tiny">
									<BadgeCheck aria-hidden="true" className="size-3.5 text-success" />
									{t("account.verified")}
								</span>
							) : verified === false && server?.features.email ? (
								<span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 font-medium text-ink text-tiny">
									<CircleAlert aria-hidden="true" className="size-3.5 text-warning" />
									{t("account.unverified")}
								</span>
							) : null}
						</dd>
					</div>
					{methods.length ? (
						<div>
							<dt className="text-ink-muted">{t("account.signInWith")}</dt>
							<dd className="mt-0.5 font-medium text-ink">{t.formatList(methods)}</dd>
						</div>
					) : null}
				</dl>
				{account ? (
					<p className="-mt-2 text-ink-muted text-small">
						{t("account.memberSince", { date: formatDate(account.createdAt, locale, 0) })}
					</p>
				) : null}
			</div>
		</SettingsSection>
	);
}
