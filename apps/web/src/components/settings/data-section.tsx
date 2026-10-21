import { downloadJson } from "@/lib/download";
import { useT } from "@/lib/messages";
import { syncController } from "@/lib/sync";
import { useActions, useLocale, useSyncState, useToday } from "@atomic/core/react";
import { useNavigate } from "@tanstack/react-router";
import { Download, FlaskConical, RotateCcw, Upload } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { SettingsRow, SettingsSection } from "./settings-section";

export function DataSection() {
	const { t, at } = useT();
	const actions = useActions();
	const locale = useLocale();
	const today = useToday();
	const navigate = useNavigate();
	const fileRef = useRef<HTMLInputElement>(null);
	const [confirm, setConfirm] = useState<"demo" | "reset" | null>(null);
	const signedIn = useSyncState(syncController).user !== null;

	const exportBackup = async () => {
		const saved = await downloadJson(`atomic-backup-${today}.json`, actions.exportData());
		if (saved) toast.success(at("settings.exported"));
		else toast.error(at("settings.exportUnavailable"));
	};

	const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (!file) return;
		let json: unknown;
		try {
			json = JSON.parse(await file.text());
		} catch {
			toast.error(t("settings.importError"));
			return;
		}
		const result = actions.importData(json, "merge");
		if (result.ok) toast.success(t.tp("settings.importSuccess", result.imported));
		else toast.error(t("settings.importError"));
	};

	return (
		<SettingsSection
			title={t("settings.data")}
			// Signed in, the account keeps a copy too (Annex C §4).
			description={signedIn ? t("sync.dataHintSignedIn") : t("settings.dataHint")}
		>
			<SettingsRow label={t("settings.export")} stack>
				<Button variant="secondary" size="sm" onClick={() => void exportBackup()}>
					<Download />
					{t("settings.export")}
				</Button>
			</SettingsRow>
			<SettingsRow label={t("settings.import")} stack>
				<input
					ref={fileRef}
					type="file"
					accept="application/json,.json"
					className="hidden"
					onChange={importBackup}
				/>
				<Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
					<Upload />
					{t("settings.import")}
				</Button>
			</SettingsRow>
			<SettingsRow label={t("settings.demo")} hint={t("settings.demoHint")} stack>
				<Button variant="secondary" size="sm" onClick={() => setConfirm("demo")}>
					<FlaskConical />
					{t("settings.demo")}
				</Button>
			</SettingsRow>
			<SettingsRow label={t("settings.reset")} hint={t("settings.resetHint")} stack>
				<Button variant="destructive-ghost" size="sm" onClick={() => setConfirm("reset")}>
					<RotateCcw />
					{t("settings.reset")}
				</Button>
			</SettingsRow>
			<ConfirmDialog
				open={confirm === "demo"}
				onOpenChange={(open) => !open && setConfirm(null)}
				title={t("settings.demo")}
				body={t("settings.demoConfirm")}
				confirmLabel={t("common.confirm")}
				onConfirm={() => {
					actions.loadDemoData(locale);
					void navigate({ to: "/" });
				}}
			/>
			<ConfirmDialog
				open={confirm === "reset"}
				onOpenChange={(open) => !open && setConfirm(null)}
				title={t("settings.reset")}
				body={t("settings.resetConfirm")}
				confirmLabel={t("common.delete")}
				destructive
				onConfirm={() => {
					if (syncController.getState().user) void syncController.signOut();
					actions.resetAll();
					void navigate({ to: "/onboarding" });
				}}
			/>
		</SettingsSection>
	);
}
