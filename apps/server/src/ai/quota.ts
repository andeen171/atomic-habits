import type { Database } from "../db";

/**
 * Per-user AI quotas (spec §4.5, Annex C §6.6), kept in `ai_usage` per UTC
 * day. Consuming is one atomic upsert that only counts when the result stays
 * within the limit, so concurrent calls can never overshoot it; a refund
 * gives the amount back to the day it was taken from (even after midnight).
 */

export type QuotaField = "requests" | "translate_chars";

export interface Reservation {
	userId: string;
	day: string;
	field: QuotaField;
	amount: number;
}

export type ConsumeResult =
	| { ok: true; used: number; reservation: Reservation }
	| { ok: false; used: number };

// One statement per field: column names are never interpolated from input.
const CONSUME: Record<QuotaField, string> = {
	requests: `INSERT INTO ai_usage (user_id, day, requests)
		SELECT :user, :day, :amount WHERE :amount <= :limit
		ON CONFLICT (user_id, day) DO UPDATE SET requests = requests + :amount
		WHERE ai_usage.requests + :amount <= :limit
		RETURNING requests AS used`,
	translate_chars: `INSERT INTO ai_usage (user_id, day, translate_chars)
		SELECT :user, :day, :amount WHERE :amount <= :limit
		ON CONFLICT (user_id, day) DO UPDATE SET translate_chars = translate_chars + :amount
		WHERE ai_usage.translate_chars + :amount <= :limit
		RETURNING translate_chars AS used`,
};

const REFUND: Record<QuotaField, string> = {
	requests: `UPDATE ai_usage SET requests = max(0, requests - :amount)
		WHERE user_id = :user AND day = :day`,
	translate_chars: `UPDATE ai_usage SET translate_chars = max(0, translate_chars - :amount)
		WHERE user_id = :user AND day = :day`,
};

const USED: Record<QuotaField, string> = {
	requests: "SELECT requests AS used FROM ai_usage WHERE user_id = :user AND day = :day",
	translate_chars:
		"SELECT translate_chars AS used FROM ai_usage WHERE user_id = :user AND day = :day",
};

/** Takes `amount` from today's `field` if it fits under `limit`. */
export async function consumeQuota(
	db: Database,
	reservation: Reservation,
	limit: number,
): Promise<ConsumeResult> {
	const args = {
		":user": reservation.userId,
		":day": reservation.day,
		":amount": reservation.amount,
		":limit": limit,
	};
	const result = await db.$client.execute({ sql: CONSUME[reservation.field], args });
	const row = result.rows[0];
	if (row) return { ok: true, used: Number(row.used), reservation };
	const current = await db.$client.execute({
		sql: USED[reservation.field],
		args: { ":user": reservation.userId, ":day": reservation.day },
	});
	return { ok: false, used: Number(current.rows[0]?.used ?? 0) };
}

/** Gives a reservation back (the call failed upstream, timed out or was refused). */
export async function refundQuota(db: Database, reservation: Reservation): Promise<void> {
	await db.$client.execute({
		sql: REFUND[reservation.field],
		args: {
			":user": reservation.userId,
			":day": reservation.day,
			":amount": reservation.amount,
		},
	});
}

/** Adds the model's output tokens to the day (capacity planning; no content). */
export async function recordTokensOut(
	db: Database,
	userId: string,
	day: string,
	tokens: number,
): Promise<void> {
	if (tokens <= 0) return;
	await db.$client.execute({
		sql: "UPDATE ai_usage SET tokens_out = tokens_out + :tokens WHERE user_id = :user AND day = :day",
		args: { ":user": userId, ":day": day, ":tokens": tokens },
	});
}
