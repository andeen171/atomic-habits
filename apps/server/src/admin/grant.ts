import { PLANS, type Plan } from "@atomic/core";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../db";
import { planGrant, user } from "../db/schema";

/**
 * Plans given by hand (`scripts/grant.ts`, spec §4.5): beta testers,
 * support gestures, the owner's own account. A grant is a `plan_grant` row;
 * `resolvePlan` prefers a paid subscription, then the best unexpired grant.
 * The running server caches each user's plan for 60 s, so a change shows
 * within a minute.
 */

export class GrantError extends Error {
	override readonly name = "GrantError";
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** Ten years: anything longer is `forever`. */
const MAX_MS = 3650 * DAY_MS;

/** `90d`, `12w`, `48h` or `forever` (null). */
export function parseDuration(text: string): number | null {
	const value = text.trim().toLowerCase();
	if (value === "forever" || value === "never") return null;
	const match = /^(\d{1,5})([hdw])$/.exec(value);
	if (!match) {
		throw new GrantError(`Invalid duration "${text}": use e.g. 90d, 12w, 48h or forever`);
	}
	const unit = match[2] === "h" ? HOUR_MS : match[2] === "w" ? 7 * DAY_MS : DAY_MS;
	const ms = Number(match[1]) * unit;
	if (ms <= 0 || ms > MAX_MS) {
		throw new GrantError("The duration must be more than zero and at most 3650 days");
	}
	return ms;
}

export function parsePlan(text: string): Plan {
	const plan = text.trim().toLowerCase();
	if (!(PLANS as readonly string[]).includes(plan)) {
		throw new GrantError(`Unknown plan "${text}": use ${PLANS.join(" or ")}`);
	}
	return plan as Plan;
}

async function userIdOf(db: Database, email: string): Promise<string> {
	const [found] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(sql`lower(${user.email})`, email.trim().toLowerCase()));
	if (!found) throw new GrantError("No account with that email");
	return found.id;
}

export interface GrantInput {
	email: string;
	plan: Plan;
	/** Milliseconds, or null for no expiry. */
	durationMs: number | null;
	reason: string;
	now: number;
}

export interface GrantResult {
	grantId: string;
	userId: string;
	/** Epoch ms; null never expires. */
	expiresAt: number | null;
}

export async function grantPlan(db: Database, input: GrantInput): Promise<GrantResult> {
	const reason = input.reason.trim();
	if (!reason || reason.length > 200) {
		throw new GrantError("Give a reason of 1 to 200 characters (it is stored with the grant)");
	}
	const userId = await userIdOf(db, input.email);
	const grantId = crypto.randomUUID();
	const expiresAt = input.durationMs === null ? null : input.now + input.durationMs;
	await db.insert(planGrant).values({
		id: grantId,
		userId,
		plan: input.plan,
		reason,
		createdAt: input.now,
		expiresAt,
	});
	return { grantId, userId, expiresAt };
}

export interface GrantRow {
	id: string;
	plan: Plan;
	reason: string;
	createdAt: number;
	expiresAt: number | null;
	active: boolean;
}

export async function listGrants(db: Database, email: string, now: number): Promise<GrantRow[]> {
	const userId = await userIdOf(db, email);
	const rows = await db
		.select({
			id: planGrant.id,
			plan: planGrant.plan,
			reason: planGrant.reason,
			createdAt: planGrant.createdAt,
			expiresAt: planGrant.expiresAt,
		})
		.from(planGrant)
		.where(eq(planGrant.userId, userId))
		.orderBy(planGrant.createdAt);
	return rows.map((row) => ({
		...row,
		active: row.expiresAt === null || row.expiresAt > now,
	}));
}

/** Ends every active grant of the user now (rows stay, as a record). Resolves to how many. */
export async function revokeGrants(db: Database, email: string, now: number): Promise<number> {
	const userId = await userIdOf(db, email);
	const ended = await db
		.update(planGrant)
		.set({ expiresAt: now })
		.where(
			and(
				eq(planGrant.userId, userId),
				or(isNull(planGrant.expiresAt), gt(planGrant.expiresAt, now)),
			),
		)
		.returning({ id: planGrant.id });
	return ended.length;
}
