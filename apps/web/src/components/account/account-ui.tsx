import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import type { Plan, SyncControllerState } from "@atomic/core";
import { Cloud, CloudAlert, CloudCheck, Crown, RefreshCw, X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "../ui/icon-button";
import { initialsOf } from "./format";

/**
 * Small pieces shared by the account screens (Annex C §4): the initials
 * avatar, the plan badge (text, never colour alone), notices and the sync
 * status line. Owner: T5.
 */

export function Avatar({
	name,
	email,
	size = "md",
	className,
}: {
	name: string;
	email: string;
	size?: "md" | "lg";
	className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"grid shrink-0 select-none place-items-center rounded-full bg-accent-soft font-semibold text-ink",
				size === "lg" ? "size-14 text-h3" : "size-11 text-body",
				className,
			)}
		>
			{initialsOf(name, email)}
		</span>
	);
}

export function PlanBadge({ plan, className }: { plan: Plan; className?: string }) {
	const { t } = useT();
	return (
		<span
			className={cn(
				"inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 font-semibold text-ink text-tiny uppercase tracking-wider",
				plan === "pro" ? "bg-accent-soft" : "bg-sunken",
				className,
			)}
		>
			{plan === "pro" ? <Crown aria-hidden="true" className="size-3" /> : null}
			{plan === "pro" ? t("plan.pro") : t("plan.free")}
		</span>
	);
}

export type NoticeTone = "danger" | "warning" | "info" | "success";

const toneClass: Record<NoticeTone, { box: string; icon: string }> = {
	danger: { box: "bg-danger-soft", icon: "text-danger" },
	warning: { box: "bg-warning-soft", icon: "text-warning" },
	info: { box: "bg-sunken", icon: "text-ink-muted" },
	success: { box: "bg-success-soft", icon: "text-success" },
};

/**
 * A banner or inline notice: icon, text, optional actions and dismiss.
 * Text is always `ink` on the soft fill (AA in both themes).
 */
export function Notice({
	tone,
	role = "status",
	icon,
	children,
	actions,
	onDismiss,
	className,
}: {
	tone: NoticeTone;
	role?: "status" | "alert" | "none";
	icon: ReactNode;
	children: ReactNode;
	actions?: ReactNode;
	onDismiss?: () => void;
	className?: string;
}) {
	const { t } = useT();
	const tones = toneClass[tone];
	return (
		<div
			role={role === "none" ? undefined : role}
			className={cn(
				"flex w-full items-start gap-2 rounded-xl py-3 pr-2 pl-3.5 sm:items-center",
				tones.box,
				className,
			)}
		>
			<div className="flex min-w-0 flex-1 flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
				<span className="flex min-w-0 flex-1 items-start gap-2.5 text-ink text-small">
					<span
						aria-hidden="true"
						className={cn("mt-0.5 flex shrink-0 [&_svg]:size-4", tones.icon)}
					>
						{icon}
					</span>
					<span className="min-w-0">{children}</span>
				</span>
				{actions ? (
					<div className="flex shrink-0 flex-wrap items-center gap-2 pr-1.5">{actions}</div>
				) : null}
			</div>
			{onDismiss ? (
				<IconButton
					label={t("sync.dismiss")}
					size="sm"
					tooltip={false}
					className="-my-1 shrink-0 text-ink-muted hover:bg-surface/60"
					onClick={onDismiss}
				>
					<X />
				</IconButton>
			) : null}
		</div>
	);
}

export interface SyncLine {
	text: string;
	tone: "ok" | "busy" | "pending" | "warn";
}

/** "Backed up 2 minutes ago" / "3 changes waiting to sync" / "Syncing…" / retrying. */
export function syncLine(
	state: SyncControllerState,
	t: ReturnType<typeof useT>["t"],
	now: number,
): SyncLine {
	if (state.status === "syncing") return { text: t("settings.syncing"), tone: "busy" };
	if (state.status === "error" && state.error !== "auth")
		return { text: t("sync.retrying"), tone: "warn" };
	if (state.pendingCount > 0)
		return { text: t.tp("sync.pending", state.pendingCount), tone: "pending" };
	if (state.lastSyncedAt)
		return {
			text: t("sync.backedUp", { time: t.formatAgo(state.lastSyncedAt, now) }),
			tone: "ok",
		};
	return { text: t("settings.neverSynced"), tone: "pending" };
}

export function SyncLineIcon({ tone, className }: { tone: SyncLine["tone"]; className?: string }) {
	const Icon =
		tone === "busy" ? RefreshCw : tone === "warn" ? CloudAlert : tone === "ok" ? CloudCheck : Cloud;
	return (
		<Icon
			aria-hidden="true"
			className={cn(
				"size-4 shrink-0",
				tone === "busy" && "animate-spin motion-reduce:animate-none",
				tone === "warn" ? "text-warning" : tone === "ok" ? "text-success" : "text-ink-muted",
				className,
			)}
		/>
	);
}

/** A spinner icon that stops for reduced motion. */
export function Spinner({ className }: { className?: string }) {
	return (
		<RefreshCw
			aria-hidden="true"
			className={cn("animate-spin motion-reduce:animate-none", className)}
		/>
	);
}
