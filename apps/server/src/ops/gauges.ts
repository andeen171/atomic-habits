import type { Config } from "../config";
import type { Database } from "../db";
import type { GaugeValue } from "./metrics";

/**
 * `atomic_users` and `atomic_pro_users` (Annex C §1.10), counted in SQL and
 * cached for 5 minutes so frequent scrapes never scan the tables.
 *
 * Pro users follow `resolvePlan` (billing/entitlements.ts) row by row:
 * billing off gives everyone `DEFAULT_PLAN`; with billing on a user is Pro
 * through a qualifying subscription (active or trialing until their period
 * ends plus the grace days, past due within the grace days), an unexpired
 * Pro grant, or a `DEFAULT_PLAN` of `pro`. The reconciliation subtleties
 * (a stale row is re-read from Stripe) don't change the count.
 */

export const GAUGES_TTL_MS = 5 * 60_000;

const DAY_MS = 86_400_000;

const PRO_USERS = `SELECT count(*) AS n FROM user u WHERE
	EXISTS (
		SELECT 1 FROM subscription s
		WHERE s.reference_id = u.id AND lower(s.plan) = 'pro' AND (
			(s.status = 'active' AND (s.period_end IS NULL OR s.period_end + :grace >= :now))
			OR (s.status = 'trialing' AND (coalesce(s.trial_end, s.period_end) IS NULL
				OR coalesce(s.trial_end, s.period_end) + :grace >= :now))
			OR (s.status = 'past_due' AND coalesce(s.period_start, :now) + :grace > :now)
		)
	)
	OR EXISTS (
		SELECT 1 FROM plan_grant g
		WHERE g.user_id = u.id AND g.plan = 'pro' AND (g.expires_at IS NULL OR g.expires_at > :now)
	)`;

export interface UserGauges {
	/** The current values (from the cache when younger than `GAUGES_TTL_MS`). */
	read(): Promise<GaugeValue[]>;
}

export function createUserGauges(deps: {
	config: Pick<Config, "billing" | "plans">;
	db: Database;
	now: () => number;
}): UserGauges {
	const { config, db, now } = deps;
	let cached: { at: number; values: GaugeValue[] } | null = null;
	let loading: Promise<GaugeValue[]> | null = null;

	const load = async (): Promise<GaugeValue[]> => {
		const at = now();
		const users = Number(
			(await db.$client.execute("SELECT count(*) AS n FROM user")).rows[0]?.n ?? 0,
		);
		let pro: number;
		if (!config.billing || config.plans.defaultPlan === "pro") {
			pro = config.plans.defaultPlan === "pro" ? users : 0;
		} else {
			const graceMs = config.billing.graceDays * DAY_MS;
			const result = await db.$client.execute({
				sql: PRO_USERS,
				args: { ":now": at, ":grace": graceMs },
			});
			pro = Number(result.rows[0]?.n ?? 0);
		}
		const values: GaugeValue[] = [
			{ name: "atomic_users", help: "Accounts on this server (cached 5 min).", value: users },
			{
				name: "atomic_pro_users",
				help: "Accounts whose plan is Pro right now (cached 5 min).",
				value: pro,
			},
		];
		cached = { at, values };
		return values;
	};

	return {
		async read() {
			if (cached && now() - cached.at < GAUGES_TTL_MS) return cached.values;
			loading ??= load().finally(() => {
				loading = null;
			});
			return loading;
		},
	};
}
