import { accountController } from "@/lib/account";
import { aiClient } from "@/lib/ai";
import { useT } from "@/lib/messages";
import { syncController } from "@/lib/sync";
import { cn } from "@/lib/utils";
import type { AiAvailability, Plan, PlanLimits, ServerInfo } from "@atomic/core";
import { useAccountState, useAiAvailability, useSyncState } from "@atomic/core/react";
import { Sparkles } from "lucide-react";

type AiFeature = NonNullable<ServerInfo["features"]["ai"]>;

export interface AiContext {
	availability: AiAvailability;
	/** The server's AI feature (hosting, limits, beta), null without one. */
	feature: AiFeature | null;
	plan: Plan;
	/** The account's own limits (falls back to the server's per-plan table). */
	limits: PlanLimits | null;
	/** Billing is on, so "Get more with Pro" can be offered. */
	billing: boolean;
	/** Pro's daily suggestions, for the upgrade line. */
	proSuggestions: number | null;
	email: string | null;
	privacyUrl: string | null;
}

/**
 * Everything an AI surface needs: availability (Annex C §1.6 matrix), the
 * server's AI feature and the account's plan and limits. Owner: T5.
 */
export function useAi(): AiContext {
	const availability = useAiAvailability(aiClient);
	const sync = useSyncState(syncController);
	const { account } = useAccountState(accountController);
	const server = sync.server;
	const feature = server?.features.ai ?? null;
	const plan = account?.entitlements.plan ?? "free";
	return {
		availability,
		feature,
		plan,
		limits: account?.entitlements.limits ?? feature?.limits[plan] ?? null,
		billing: Boolean(server?.features.billing),
		proSuggestions: feature?.limits.pro?.aiRequestsPerDay ?? null,
		email: account?.email ?? sync.user?.email ?? null,
		privacyUrl: server?.legal.privacyUrl ?? null,
	};
}

/** The "Beta" badge every AI surface carries while `features.ai.beta` is on (D31). */
export function AiBadge({ className }: { className?: string }) {
	const { t } = useT();
	return (
		<span
			className={cn(
				"inline-flex h-5 shrink-0 items-center rounded-full bg-accent-soft px-2 font-semibold text-[10px] text-accent-text uppercase leading-none tracking-wider",
				className,
			)}
		>
			{t("ai.beta")}
		</span>
	);
}

/** "✦ AI · Beta": the caption under AI suggestions. */
export function AiCaption({ beta, className }: { beta: boolean; className?: string }) {
	const { t } = useT();
	return (
		<span className={cn("inline-flex items-center gap-1.5 text-ink-muted text-tiny", className)}>
			<Sparkles aria-hidden="true" className="size-3.5 text-accent-text" />
			{beta ? `${t("ai.label")} · ${t("ai.beta")}` : t("ai.label")}
		</span>
	);
}
