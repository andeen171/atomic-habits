import type { Entitlements } from "@atomic/core";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import type { Config } from "../config";
import type { Database } from "../db";
import { planGrant } from "../db/schema";
import { planLimits } from "./limits";

/**
 * What a user may use: plan, status and limits (Annex C §1.4).
 *
 * Milestone A covers billing off (everyone gets `DEFAULT_PLAN`) and, with
 * billing on, hand-made grants; Stripe subscriptions and the 60 s cache come
 * with billing (milestone C), ranked before grants as in `resolvePlan`.
 */
export interface EntitlementService {
	get(userId: string): Promise<Entitlements>;
	/** Drop any cached value for the user (webhooks, grants). */
	invalidate(userId: string): void;
}

export function createEntitlements(deps: {
	config: Config;
	db: Database;
	now: () => number;
}): EntitlementService {
	const { config, db, now } = deps;
	const none = { renewsAt: null, endsAt: null, graceUntil: null } as const;

	return {
		async get(userId) {
			if (!config.billing) {
				const plan = config.plans.defaultPlan;
				return {
					plan,
					source: "billing-disabled",
					status: "active",
					...none,
					limits: planLimits(config, plan),
					canManageBilling: false,
				};
			}
			const at = now();
			const [grant] = await db
				.select({ plan: planGrant.plan, expiresAt: planGrant.expiresAt })
				.from(planGrant)
				.where(
					and(
						eq(planGrant.userId, userId),
						or(isNull(planGrant.expiresAt), gt(planGrant.expiresAt, at)),
					),
				)
				// The best grant first ("pro" sorts after "free").
				.orderBy(desc(planGrant.plan))
				.limit(1);
			if (grant) {
				return {
					plan: grant.plan,
					source: "grant",
					status: "active",
					...none,
					endsAt: grant.expiresAt ?? null,
					limits: planLimits(config, grant.plan),
					canManageBilling: false,
				};
			}
			return {
				plan: "free",
				source: "none",
				status: "none",
				...none,
				limits: planLimits(config, "free"),
				canManageBilling: false,
			};
		},
		invalidate() {
			// Nothing cached yet.
		},
	};
}
