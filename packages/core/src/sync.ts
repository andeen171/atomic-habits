import { z } from "zod";
import { COLLECTIONS, type Collection } from "./model";

/**
 * Sync protocol shared by clients and `apps/server`.
 *
 * Every entity is a document identified by (collection, id). Clients push the
 * documents they changed; the server keeps the version with the greatest
 * `updatedAt` (last-write-wins) and stamps each accepted write with a
 * monotonically increasing sequence. Clients pull everything after the last
 * sequence they saw.
 */

export const syncRecordSchema = z.object({
	collection: z.enum(COLLECTIONS),
	id: z.string().min(1).max(80),
	updatedAt: z.number(),
	deletedAt: z.number().nullable(),
	/** The full entity as stored on the client. */
	data: z.record(z.string(), z.unknown()),
});
export type SyncRecord = z.infer<typeof syncRecordSchema>;

export const MAX_PUSH_BATCH = 500;
export const MAX_PULL_BATCH = 1000;

export const pushInputSchema = z.object({
	records: z.array(syncRecordSchema).max(MAX_PUSH_BATCH),
});
export type PushInput = z.infer<typeof pushInputSchema>;

export const pushOutputSchema = z.object({
	accepted: z.number(),
	cursor: z.number(),
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
