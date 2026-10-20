import type { SessionInfo } from "@atomic/core";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import type { Database } from "../db";
import { session } from "../db/schema";
import { revokeExportLinks } from "./export";

/**
 * Signed-in devices (spec §4.3, Annex C §0.5): own procedures instead of
 * Better Auth's `/list-sessions` (which needs a fresh session and returns
 * every session's token). These return ids, times and the device label only:
 * never a token or an IP.
 */

/** The user's live sessions, the current one first, then the most recently active. */
export async function listSessions(
	db: Database,
	userId: string,
	currentId: string,
	now: number,
): Promise<SessionInfo[]> {
	const rows = await db
		.select({
			id: session.id,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
			userAgent: session.userAgent,
		})
		.from(session)
		.where(and(eq(session.userId, userId), gt(session.expiresAt, new Date(now))))
		.orderBy(desc(session.updatedAt));
	return rows
		.map((row) => ({
			id: row.id,
			createdAt: row.createdAt.getTime(),
			lastActiveAt: row.updatedAt.getTime(),
			device: row.userAgent || null,
			current: row.id === currentId,
		}))
		.sort((a, b) => Number(b.current) - Number(a.current));
}

/**
 * Ends one of the user's sessions (that device gets 401 on its next
 * request). Export links carry no session, so the user's outstanding links
 * end too: one of them may come from that device.
 */
export async function revokeSession(db: Database, userId: string, id: string): Promise<number> {
	const deleted = await db
		.delete(session)
		.where(and(eq(session.userId, userId), eq(session.id, id)))
		.returning({ id: session.id });
	if (deleted.length > 0) await revokeExportLinks(db, userId);
	return deleted.length;
}

/** "Sign out of all other devices": every session but the current one, and every export link. */
export async function revokeOtherSessions(
	db: Database,
	userId: string,
	currentId: string,
): Promise<number> {
	const deleted = await db
		.delete(session)
		.where(and(eq(session.userId, userId), ne(session.id, currentId)))
		.returning({ id: session.id });
	await revokeExportLinks(db, userId);
	return deleted.length;
}
