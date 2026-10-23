import type { Entitlements, Plan, PlanLimits } from "@atomic/core";
import { eq } from "drizzle-orm";
import type { Config } from "../config";
import type { Database } from "../db";
import { planGrant, subscription } from "../db/schema";

/**
 * What a user may use: plan, status and limits (Annex C §1.4, spec §4.5).
 *
 * `resolvePlan` is pure and knows nothing about Stripe beyond the status
 * names the `subscription` table stores: a different `BillingProvider` only
 * has to fill the same rows. `createEntitlements` loads the rows, resolves
 * them and caches the answer for 60 s per user; webhooks, grants and
 * deletion invalidate it.
 */

const DAY_MS = 86_400_000;

/** One `subscription` row as `resolvePlan` reads it (dates in epoch ms). */
export interface SubscriptionState {
	plan: string;
	status: string | null;
	periodStart: number | null;
	periodEnd: number | null;
	trialEnd: number | null;
	cancelAtPeriodEnd: boolean | null;
	/** A scheduled cancellation date (Stripe `cancel_at`); counts as canceling. */
	cancelAt: number | null;
	stripeCustomerId: string | null;
	stripeSubscriptionId: string | null;
}

/** One `plan_grant` row (`scripts/grant.ts`). */
export interface GrantState {
	plan: Plan;
	/** Epoch ms; null never expires. */
	expiresAt: number | null;
}

export interface PlanRules {
	/** Billing configured (Stripe variables present). */
	billing: boolean;
	/** `DEFAULT_PLAN`: everyone's plan with billing off, the fallback with it on. */
	defaultPlan: Plan;
	/** `BILLING_GRACE_DAYS`: past-due grace and the stale-row safety net. */
	graceDays: number;
	limits: Record<Plan, PlanLimits>;
}

export interface ResolvedPlan {
	entitlements: Entitlements;
	/**
	 * Provider subscription ids whose row looks stale (still active or
	 * trialing a day after its period ended: a webhook was probably missed).
	 * The caller asks the provider for their current state (throttled).
	 */
	reconcile: string[];
}

type PaidStatus = "active" | "trialing" | "canceling" | "grace";

/** Preference when several subscriptions qualify (Annex C §1.4). */
const RANK: Record<PaidStatus, number> = { active: 0, trialing: 1, canceling: 2, grace: 3 };

interface Candidate {
	status: PaidStatus;
	renewsAt: number | null;
	endsAt: number | null;
	graceUntil: number | null;
	periodEnd: number | null;
}

/** Statuses that never had a payment method attached (abandoned checkouts). */
const NEVER_PAID = new Set(["incomplete", "incomplete_expired"]);

/**
 * One row against the table of Annex C §1.4. `stale` asks for a
 * reconciliation even when the row no longer qualifies.
 */
function evaluate(
	sub: SubscriptionState,
	graceMs: number,
	now: number,
): { candidate: Candidate | null; stale: boolean } {
	if (sub.plan.toLowerCase() !== "pro") return { candidate: null, stale: false };
	switch (sub.status) {
		case "active": {
			const end = sub.periodEnd;
			const stale = end !== null && now > end + DAY_MS;
			// Missed webhooks: an active row this far past its period is not trusted.
			if (end !== null && now > end + graceMs) return { candidate: null, stale };
			const canceling = Boolean(sub.cancelAtPeriodEnd) || sub.cancelAt !== null;
			return {
				candidate: canceling
					? {
							status: "canceling",
							renewsAt: null,
							endsAt: sub.cancelAt ?? end,
							graceUntil: null,
							periodEnd: end,
						}
					: { status: "active", renewsAt: end, endsAt: null, graceUntil: null, periodEnd: end },
				stale,
			};
		}
		case "trialing": {
			const end = sub.trialEnd ?? sub.periodEnd;
			const stale = end !== null && now > end + DAY_MS;
			if (end !== null && now > end + graceMs) return { candidate: null, stale };
			return {
				candidate: {
					status: "trialing",
					renewsAt: null,
					endsAt: end,
					graceUntil: null,
					periodEnd: sub.periodEnd,
				},
				stale,
			};
		}
		case "past_due": {
			const graceUntil = (sub.periodStart ?? now) + graceMs;
			if (now >= graceUntil) return { candidate: null, stale: false };
			return {
				candidate: {
					status: "grace",
					renewsAt: null,
					endsAt: null,
					graceUntil,
					periodEnd: sub.periodEnd,
				},
				stale: false,
			};
		}
		// unpaid, canceled, incomplete, incomplete_expired, paused, anything new.
		default:
			return { candidate: null, stale: false };
	}
}

const PLAN_RANK: Record<Plan, number> = { free: 0, pro: 1 };

/**
 * The plan a user has right now (pure; Annex C §1.4):
 * 1. billing off: `DEFAULT_PLAN` for everyone;
 * 2. the best qualifying subscription (active > trialing > canceling >
 *    grace, then the latest period end);
 * 3. else the best unexpired grant;
 * 4. else `DEFAULT_PLAN` (`free` unless the operator says otherwise).
 */
export function resolvePlan(
	subs: readonly SubscriptionState[],
	grants: readonly GrantState[],
	rules: PlanRules,
	now: number,
): ResolvedPlan {
	const none = { renewsAt: null, endsAt: null, graceUntil: null };
	if (!rules.billing) {
		return {
			entitlements: {
				plan: rules.defaultPlan,
				source: "billing-disabled",
				status: "active",
				...none,
				limits: rules.limits[rules.defaultPlan],
				canManageBilling: false,
			},
			reconcile: [],
		};
	}

	// The portal is worth offering once there was a real subscription
	// (invoices stay there after it ends), not after an abandoned checkout.
	const canManageBilling = subs.some(
		(s) => Boolean(s.stripeCustomerId) && !NEVER_PAID.has(s.status ?? "incomplete"),
	);
	const graceMs = rules.graceDays * DAY_MS;
	const reconcile: string[] = [];
	const candidates: Candidate[] = [];
	for (const sub of subs) {
		const { candidate, stale } = evaluate(sub, graceMs, now);
		if (stale && sub.stripeSubscriptionId) reconcile.push(sub.stripeSubscriptionId);
		if (candidate) candidates.push(candidate);
	}
	candidates.sort(
		(a, b) =>
			RANK[a.status] - RANK[b.status] ||
			(b.periodEnd ?? Number.NEGATIVE_INFINITY) - (a.periodEnd ?? Number.NEGATIVE_INFINITY) ||
			0,
	);
	const [best] = candidates;
	if (best) {
		return {
			entitlements: {
				plan: "pro",
				source: "stripe",
				status: best.status,
				renewsAt: best.renewsAt,
				endsAt: best.endsAt,
				graceUntil: best.graceUntil,
				limits: rules.limits.pro,
				canManageBilling,
			},
			reconcile,
		};
	}

	const [grant] = grants
		.filter((g) => g.expiresAt === null || g.expiresAt > now)
		.sort((a, b) => {
			const byPlan = PLAN_RANK[b.plan] - PLAN_RANK[a.plan];
			if (byPlan) return byPlan;
			if (a.expiresAt === b.expiresAt) return 0;
			if (a.expiresAt === null) return -1;
			if (b.expiresAt === null) return 1;
			return b.expiresAt - a.expiresAt;
		});
	if (grant) {
		return {
			entitlements: {
				plan: grant.plan,
				source: "grant",
				status: "active",
				...none,
				endsAt: grant.expiresAt,
				limits: rules.limits[grant.plan],
				canManageBilling,
			},
			reconcile,
		};
	}

	return {
		entitlements: {
			plan: rules.defaultPlan,
			source: "none",
			status: "none",
			...none,
			limits: rules.limits[rules.defaultPlan],
			canManageBilling,
		},
		reconcile,
	};
}

/** The `PlanRules` of a configuration. */
export function planRules(config: Pick<Config, "billing" | "plans">): PlanRules {
	return {
		billing: config.billing !== null,
		defaultPlan: config.plans.defaultPlan,
		graceDays: config.billing?.graceDays ?? 14,
		limits: config.plans.limits,
	};
}

export interface EntitlementService {
	get(userId: string): Promise<Entitlements>;
	/** Drop any cached value for the user (webhooks, grants, reconciliation, deletion). */
	invalidate(userId: string): void;
}

/** How long a resolved plan is served from memory (spec §4.5). */
export const ENTITLEMENTS_TTL_MS = 60_000;

/** Sweep expired cache entries once the table grows past this many users. */
const SWEEP_AT = 10_000;

const ms = (date: Date | null) => (date ? date.getTime() : null);

export function createEntitlements(deps: {
	config: Pick<Config, "billing" | "plans">;
	db: Database;
	now: () => number;
	/**
	 * Called (not awaited) when a row looks stale; the billing provider
	 * re-reads those subscriptions, at most once per user per hour.
	 */
	onStale?: (userId: string, subscriptionIds: string[]) => void;
}): EntitlementService {
	const { config, db, now } = deps;
	const rules = planRules(config);
	const cache = new Map<string, { value: Entitlements; until: number }>();
	// A read that started before an invalidation must not cache what it read.
	// Each invalidation records its sequence number and when it happened; an
	// entry only matters while a read that began before it is in flight.
	let sequence = 0;
	const invalidatedAt = new Map<string, { seq: number; at: number }>();

	const load = async (userId: string) => {
		const [subs, grants] = await Promise.all([
			db
				.select({
					plan: subscription.plan,
					status: subscription.status,
					periodStart: subscription.periodStart,
					periodEnd: subscription.periodEnd,
					trialEnd: subscription.trialEnd,
					cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
					cancelAt: subscription.cancelAt,
					stripeCustomerId: subscription.stripeCustomerId,
					stripeSubscriptionId: subscription.stripeSubscriptionId,
				})
				.from(subscription)
				.where(eq(subscription.referenceId, userId)),
			db
				.select({ plan: planGrant.plan, expiresAt: planGrant.expiresAt })
				.from(planGrant)
				.where(eq(planGrant.userId, userId)),
		]);
		return {
			subs: subs.map(
				(s): SubscriptionState => ({
					...s,
					periodStart: ms(s.periodStart),
					periodEnd: ms(s.periodEnd),
					trialEnd: ms(s.trialEnd),
					cancelAt: ms(s.cancelAt),
				}),
			),
			grants,
		};
	};

	return {
		async get(userId) {
			if (!config.billing) return resolvePlan([], [], rules, now()).entitlements;
			const at = now();
			const hit = cache.get(userId);
			if (hit && at < hit.until) return hit.value;

			const ticket = sequence;
			const { subs, grants } = await load(userId);
			const resolved = resolvePlan(subs, grants, rules, now());
			if ((invalidatedAt.get(userId)?.seq ?? -1) < ticket) {
				if (cache.size >= SWEEP_AT) {
					for (const [key, entry] of cache) if (entry.until <= at) cache.delete(key);
				}
				cache.set(userId, { value: resolved.entitlements, until: at + ENTITLEMENTS_TTL_MS });
			}
			if (resolved.reconcile.length) deps.onStale?.(userId, resolved.reconcile);
			return resolved.entitlements;
		},
		invalidate(userId) {
			cache.delete(userId);
			const at = now();
			if (invalidatedAt.size >= SWEEP_AT) {
				// No read stays in flight for a whole TTL; older marks guard nothing.
				for (const [key, mark] of invalidatedAt) {
					if (at - mark.at >= ENTITLEMENTS_TTL_MS) invalidatedAt.delete(key);
				}
			}
			invalidatedAt.set(userId, { seq: sequence++, at });
		},
	};
}
