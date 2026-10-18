import { z } from "zod";
import { COLLECTIONS, type Collection, timestampSchema } from "./model";

/**
 * Sync protocol shared by clients and `apps/server`.
 *
 * Every entity is a document identified by (collection, id). Clients push the
 * documents they changed; the server keeps the version with the greatest
 * `updatedAt` (last-write-wins) and stamps each accepted write with a
 * monotonically increasing sequence. Clients pull everything after the last
 * sequence they saw.
 *
 * A pushed record that loses to a newer stored version comes back in
 * `conflicts` so the client converges immediately; an invalid record comes
 * back in `rejected`. If a client's cursor is ahead of the server (a restored
 * database), pull answers `reset: true` and the client re-uploads everything.
 */

export const syncRecordSchema = z.object({
	collection: z.enum(COLLECTIONS),
	id: z.string().min(1).max(80),
	updatedAt: timestampSchema,
	deletedAt: timestampSchema.nullable(),
	/** The full entity as stored on the client. */
	data: z.record(z.string(), z.unknown()),
});
export type SyncRecord = z.infer<typeof syncRecordSchema>;

export const MAX_PUSH_BATCH = 500;
/** Upper bound for one serialized record (real entities are well under 4 KB). */
export const MAX_RECORD_BYTES = 64 * 1024;
export const MAX_PULL_BATCH = 1000;

export const pushInputSchema = z.object({
	records: z.array(syncRecordSchema).max(MAX_PUSH_BATCH),
});
export type PushInput = z.infer<typeof pushInputSchema>;

export const rejectedRecordSchema = z.object({
	collection: z.enum(COLLECTIONS),
	id: z.string(),
	reason: z.string(),
});
export type RejectedRecord = z.infer<typeof rejectedRecordSchema>;

export const pushOutputSchema = z.object({
	accepted: z.number(),
	cursor: z.number(),
	/** Invalid records that were not stored. */
	rejected: z.array(rejectedRecordSchema).optional(),
	/** Stored versions that won over pushed records (newer `updatedAt`). */
	conflicts: z.array(syncRecordSchema).optional(),
});
export type PushOutput = z.infer<typeof pushOutputSchema>;

export const pullInputSchema = z.object({
	cursor: z.number().int().min(0),
	limit: z.number().int().min(1).max(MAX_PULL_BATCH).optional(),
});
export type PullInput = z.infer<typeof pullInputSchema>;

export const pullOutputSchema = z.object({
	records: z.array(syncRecordSchema),
	cursor: z.number(),
	hasMore: z.boolean(),
	/** The client's cursor is ahead of the server: start over from 0 and re-upload. */
	reset: z.boolean().optional(),
});
export type PullOutput = z.infer<typeof pullOutputSchema>;

export interface SyncTransport {
	push(input: PushInput): Promise<PushOutput>;
	pull(input: PullInput): Promise<PullOutput>;
}

export function pendingKey(collection: Collection, id: string): string {
	return `${collection}/${id}`;
}

export function parsePendingKey(key: string): { collection: Collection; id: string } | null {
	const slash = key.indexOf("/");
	if (slash < 0) return null;
	const collection = key.slice(0, slash) as Collection;
	if (!COLLECTIONS.includes(collection)) return null;
	return { collection, id: key.slice(slash + 1) };
}

/** Last-write-wins: does `incoming` replace `current`? */
export function shouldReplace(
	current: { updatedAt: number } | undefined,
	incoming: { updatedAt: number },
): boolean {
	return !current || incoming.updatedAt > current.updatedAt;
}
