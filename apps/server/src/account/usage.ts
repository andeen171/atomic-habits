import { type Usage, nextUtcMidnight } from "@atomic/core";
import type { Database } from "../db";

/** The UTC day key (`YYYY-MM-DD`) of `now`: AI quotas reset at 00:00 UTC. */
export function utcDay(now: number): string {
	return new Date(now).toISOString().slice(0, 10);
}

/**
 * What the user consumes (`AccountInfo.usage`): today's AI requests and
 * translated characters, photo storage, and synced document bytes. One query.
 */
export async function getUsage(db: Database, userId: string, now: number): Promise<Usage> {
	const result = await db.$client.execute({
		sql: `SELECT
			(SELECT requests FROM ai_usage WHERE user_id = :user AND day = :day) AS ai_requests,
			(SELECT translate_chars FROM ai_usage WHERE user_id = :user AND day = :day) AS ai_chars,
			(SELECT coalesce(sum(size), 0) FROM blob WHERE user_id = :user) AS blob_bytes,
			(SELECT count(*) FROM blob WHERE user_id = :user) AS blob_count,
			(SELECT bytes FROM sync_cursor WHERE user_id = :user) AS sync_bytes`,
		args: { ":user": userId, ":day": utcDay(now) },
	});
	const row: Record<string, unknown> = result.rows[0] ?? {};
	const n = (value: unknown) => Number(value ?? 0);
	return {
		aiRequestsToday: n(row.ai_requests),
		aiTranslateCharsToday: n(row.ai_chars),
		aiResetsAt: nextUtcMidnight(now),
		blobBytes: n(row.blob_bytes),
		blobCount: n(row.blob_count),
		syncBytes: n(row.sync_bytes),
	};
}
