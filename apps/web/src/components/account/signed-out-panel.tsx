import { askExistingData, useAuthDialog } from "@/lib/account";
import { useT } from "@/lib/messages";
import { officialServerUrl, syncController } from "@/lib/sync";
import { cn } from "@/lib/utils";
import { accountErrorKey } from "@atomic/core";
import { useSyncState } from "@atomic/core/react";
import { Server } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { serverName } from "./format";
import { GoogleButton, googleAvailable } from "./google-button";
import { useServerInfo } from "./use-server-info";

/**
 * Signed out (Annex C §4): Continue with Google (where the server offers
 * it here), Sign in and Create account, and the server line "Server:
 * Atomic Cloud · Use a different server". Used by Settings → Account &
 * sync and the Account page. Owner: T5.
 */
export function SignedOutPanel({ size = "md" }: { size?: "md" | "lg" }) {
	const { t } = useT();
	const openAuth = useAuthDialog((s) => s.openAuth);
	const sync = useSyncState(syncController);
	const server = useServerInfo(sync.serverUrl, 0);
	const [pending, setPending] = useState(false);
	const google = googleAvailable(server.info);

	const onGoogle = async (idToken: string, nonce: string | undefined) => {
		const url = sync.serverUrl;
		if (!url || pending) return;
		setPending(true);
		try {
			const outcome = await syncController.signInWithGoogle(url, idToken, nonce, {
				onExistingData: askExistingData,
			});
			const user = syncController.getState().user;
			if (outcome === "signed-in")
				toast.success(t("settings.signedInAs", { email: user?.email ?? "" }));
			else toast(t("account.signInCanceled"));
		} catch (error) {
			toast.error(t(accountErrorKey(error)));
		} finally {
			setPending(false);
		}
	};

	const lg = size === "lg";
	return (
		<div className={cn("flex flex-col gap-4", lg ? "" : "px-5 py-5")}>
			<div
				className={cn(
					"flex flex-col gap-2.5",
					lg ? "sm:flex-row sm:flex-wrap sm:items-center" : "sm:flex-row sm:flex-wrap",
				)}
			>
				{google ? (
					<GoogleButton
						server={server.info}
						onCredential={(token, nonce) => void onGoogle(token, nonce)}
						disabled={pending}
						className="sm:w-64"
					/>
				) : null}
				<Button
					size={lg ? "lg" : "md"}
					disabled={pending}
					onClick={() => openAuth("signIn")}
					className="w-full sm:w-auto"
				>
					{t("settings.signIn")}
				</Button>
				<Button
					variant="secondary"
					size={lg ? "lg" : "md"}
					disabled={pending}
					onClick={() => openAuth("signUp")}
					className="w-full sm:w-auto"
				>
					{t("settings.signUp")}
				</Button>
			</div>
			{officialServerUrl || sync.serverUrl ? (
				<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-muted text-small">
					<Server aria-hidden="true" className="size-4 shrink-0" />
					<span>
						{t("account.serverLine", {
							server: serverName(sync.serverUrl, officialServerUrl, t("account.serverOfficial")),
						})}
					</span>
					<span aria-hidden="true">·</span>
					<button
						type="button"
						onClick={() => openAuth("signIn", { advanced: true })}
						className="rounded-sm font-medium text-accent-text underline-offset-4 hover:underline"
					>
						{t("account.serverChange")}
					</button>
				</p>
			) : null}
		</div>
	);
}
