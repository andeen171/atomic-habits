import { useArtifactCloudStatus } from "@/lib/artifact-cloud";
import { downloadJson } from "@/lib/download";
import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { useActions, useAtomic, useToday } from "@atomic/core/react";
import { CloudOff, Download, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";

/**
 * Account and storage banners above every page of the shell (Annex C §4,
 * spec §5.9): verify email, payment grace, server outdated, clock skew,
 * session ended, `persistError`, `sync.quotaFull` and, in the artifact
 * build, `sync.cloudPaused`. Owner: T5.
 *
 * Phase 1B renders the two that need no account:
 * - `persistError` (spec §2.6.5): this device could not save. A blocking,
 *   sticky alert with "Export backup".
 * - "Cloud saving paused" (artifact build, spec §2.10): the viewer's cloud
 *   copy refused a write; it retries on the next change.
 */
export function CloudBanners() {
	const { t } = useT();
	const persistError = useAtomic((s) => s.persistError);
	const cloud = useArtifactCloudStatus();
	if (!persistError && cloud !== "paused") return null;
	return (
		<div className="sticky top-0 z-20 flex flex-col gap-2 bg-bg/90 px-5 pt-3 pb-1 backdrop-blur-xl md:px-8 lg:px-10">
			{persistError ? (
				<Banner tone="danger" role="alert" icon={<TriangleAlert />} text={t("sync.persistError")} />
			) : null}
			{cloud === "paused" ? (
				<Banner tone="warning" role="status" icon={<CloudOff />} text={t("sync.cloudPaused")} />
			) : null}
		</div>
	);
}

function Banner({
	tone,
	role,
	icon,
	text,
}: {
	tone: "danger" | "warning";
	role: "alert" | "status";
	icon: ReactNode;
	text: string;
}) {
	return (
		<div
			role={role}
			className={cn(
				"mx-auto flex w-full max-w-[1160px] flex-col gap-3 rounded-xl p-3.5 sm:flex-row sm:items-center",
				tone === "danger" ? "bg-danger-soft" : "bg-warning-soft",
			)}
		>
			<span
				className={cn(
					"flex min-w-0 flex-1 items-start gap-2.5 text-ink text-small [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
					tone === "danger" ? "[&_svg]:text-danger" : "[&_svg]:text-warning",
				)}
			>
				{icon}
				<span className="min-w-0">{text}</span>
			</span>
			<ExportButton />
		</div>
	);
}

function ExportButton() {
	const { t, at } = useT();
	const actions = useActions();
	const today = useToday();
	const exportBackup = async () => {
		const saved = await downloadJson(`atomic-backup-${today}.json`, actions.exportData());
		if (saved) toast.success(at("settings.exported"));
		else toast.error(at("settings.exportUnavailable"));
	};
	return (
		<Button
			variant="secondary"
			size="sm"
			className="self-start sm:self-auto"
			onClick={() => void exportBackup()}
		>
			<Download />
			{t("settings.export")}
		</Button>
	);
}
