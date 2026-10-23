import { z } from "zod";
import { COLLECTIONS, type Collection, collectionSchemas, timestampSchema } from "./model";

// Wire-level constants that live in `model.ts` (no import cycle); also served from `@atomic/core/sync`.
export { SCHEMA_REV, V1_COLLECTIONS } from "./model";

/**
 * Sync protocol shared by clients and `apps/server` (spec §2.7).
 *
 * Every entity is a document identified by (collection, id). Clients push the
 * documents they changed; the server keeps the version with the greatest
 * `updatedAt` (last-write-wins; equal `updatedAt` is broken by content, see
 * `compareVersions`) and stamps each accepted write with a monotonically
 * increasing sequence. Clients pull everything after the last sequence they
 * saw.
 *
 * A pushed record that loses to the stored version comes back in
 * `conflicts` so the client converges immediately; a refused record comes
 * back in `rejected` with a `code`. If a client's cursor is ahead of the
 * server (a restored database), pull answers `reset: true` and the client
 * re-uploads everything.
 *
 * The wire is open: `collection` is any camelCase name, so documents of
 * collections one side doesn't know travel per record instead of failing the
 * whole request (`unknown-collection` on push, skipped on pull).
 */

/** Amends Annex C (D2): camelCase allowed ("taskLogs"). */
export const COLLECTION_RE = /^[a-z][a-zA-Z0-9]{0,39}$/;

/** A record of a collection this build knows (v1 wire schema; still used for typed records). */
export const syncRecordSchema = z.object({
	collection: z.enum(COLLECTIONS),
	id: z.string().min(1).max(80),
	updatedAt: timestampSchema,
	deletedAt: timestampSchema.nullable(),
	/** The full entity as stored on the client. */
	data: z.record(z.string(), z.unknown()),
});
export type SyncRecord = z.infer<typeof syncRecordSchema>;

/** What travels: any well-formed collection name, known or not. */
export const wireSyncRecordSchema = syncRecordSchema.extend({
	collection: z.string().regex(COLLECTION_RE),
});
export type WireSyncRecord = z.infer<typeof wireSyncRecordSchema>;

export const MAX_PUSH_BATCH = 500;
/** Upper bound for one record, in UTF-8 bytes of its JSON (`serializedBytes`). */
export const MAX_RECORD_BYTES = 64 * 1024;
export const MAX_PULL_BATCH = 1000;
/** Was 24 h; safe because `stamp()` is clock-corrected (D45). */
export const MAX_FUTURE_MS = 10 * 60 * 1000;
/** UTF-8 bytes per push request; the tRPC body limit is 8 MiB. */
export const MAX_PUSH_BYTES = 4 * 1024 * 1024;
/** A server/device clock difference above this is corrected by `stamp()` and shown as a banner. */
export const CLOCK_SKEW_MS = 2 * 60 * 1000;

export const pushInputSchema = z.object({
	records: z.array(wireSyncRecordSchema).max(MAX_PUSH_BATCH),
});
export type PushInput = z.infer<typeof pushInputSchema>;

export const REJECT_CODES = [
	"invalid",
	"too-large",
	"unknown-collection",
	"future-timestamp",
	"quota",
] as const;
export type RejectCode = (typeof REJECT_CODES)[number];
/** Rejections the client keeps pending (they succeed later: server upgrade, clock fix, more quota). */
export const KEEP_PENDING_CODES = ["unknown-collection", "future-timestamp", "quota"] as const;
export type KeepPendingCode = (typeof KEEP_PENDING_CODES)[number];

export const rejectedRecordSchema = z.object({
	collection: z.string(),
	id: z.string(),
	/** `${path}: ${issue.code}` for schema failures; never a zod message, never a value. */
	reason: z.string(),
	/** Absent from v1 servers. */
	code: z.enum(REJECT_CODES).optional(),
});
export type RejectedRecord = z.infer<typeof rejectedRecordSchema>;

export const pushOutputSchema = z.object({
	accepted: z.number(),
	cursor: z.number(),
	/** Records that were not stored. */
	rejected: z.array(rejectedRecordSchema).optional(),
	/** Stored versions that won over pushed records (`compareVersions`: newer, or an equal-stamp tie). */
	conflicts: z.array(wireSyncRecordSchema).optional(),
	/** Server clock (ms) when it answered; absent from v1 servers. */
	serverTime: z.number().optional(),
});
export type PushOutput = z.infer<typeof pushOutputSchema>;

export const pullInputSchema = z.object({
	cursor: z.number().int().min(0),
	limit: z.number().int().min(1).max(MAX_PULL_BATCH).optional(),
});
export type PullInput = z.infer<typeof pullInputSchema>;

export const pullOutputSchema = z.object({
	records: z.array(wireSyncRecordSchema),
	cursor: z.number(),
	hasMore: z.boolean(),
	/** The client's cursor is ahead of the server: start over from 0 and re-upload. */
	reset: z.boolean().optional(),
	/** Server clock (ms) when it answered; absent from v1 servers. */
	serverTime: z.number().optional(),
});
export type PullOutput = z.infer<typeof pullOutputSchema>;

export interface SyncTransport {
	push(input: PushInput): Promise<PushOutput>;
	pull(input: PullInput): Promise<PullOutput>;
}

/**
 * UTF-8 byte length of `JSON.stringify(x)` (0 when `x` serializes to
 * nothing). Used for `MAX_PUSH_BYTES`, `MAX_RECORD_BYTES` and the artifact
 * chunks. Counted by hand (no `TextEncoder`): lone surrogates count 3 bytes,
 * as `TextEncoder` encodes them as U+FFFD.
 */
export function serializedBytes(x: unknown): number {
	const json = JSON.stringify(x);
	if (json === undefined) return 0;
	let bytes = 0;
	for (let i = 0; i < json.length; i++) {
		const code = json.charCodeAt(i);
		if (code < 0x80) bytes += 1;
		else if (code < 0x800) bytes += 2;
		else if (code >= 0xd800 && code <= 0xdbff && i + 1 < json.length) {
			const next = json.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				bytes += 4;
				i++;
			} else bytes += 3;
		} else bytes += 3;
	}
	return bytes;
}

export type WireCheck =
	| { ok: true; data: Record<string, unknown> }
	| { ok: false; code: RejectCode; reason: string };

const KNOWN: ReadonlySet<string> = new Set(COLLECTIONS);

const isCollection = (name: string): name is Collection => KNOWN.has(name);

/**
 * Validates one pushed record the way clients read it back: the collection
 * schema applied to `data` merged with the envelope's id/updatedAt/deletedAt.
 * On success `data` is that merged object (not the parsed one), so fields
 * written by newer clients survive the round trip.
 *
 * Shared by the server and the tests. Order: unknown-collection → too-large →
 * future-timestamp → schema. `reason` is `${path}: ${issue.code}` for schema
 * failures: never a zod message, never a value.
 */
export function validateWireRecord(record: WireSyncRecord, now: number): WireCheck {
	if (!isCollection(record.collection)) {
		return { ok: false, code: "unknown-collection", reason: "collection: unknown-collection" };
	}
	const data: Record<string, unknown> = {
		...record.data,
		id: record.id,
		updatedAt: record.updatedAt,
		deletedAt: record.deletedAt,
	};
	if (serializedBytes(data) > MAX_RECORD_BYTES) {
		return { ok: false, code: "too-large", reason: `$: larger than ${MAX_RECORD_BYTES} bytes` };
	}
	if (record.updatedAt > now + MAX_FUTURE_MS) {
		return { ok: false, code: "future-timestamp", reason: "updatedAt: future-timestamp" };
	}
	const result = collectionSchemas[record.collection].safeParse(data);
	if (result.success) return { ok: true, data };
	const issue = result.error.issues[0];
	const path = issue?.path.length ? issue.path.map(String).join(".") : "$";
	return { ok: false, code: "invalid", reason: `${path}: ${issue?.code ?? "invalid"}` };
}

export function pendingKey(collection: string, id: string): string {
	return `${collection}/${id}`;
}

/** The collection and id of a pending key of a known collection; null otherwise. */
export function parsePendingKey(key: string): { collection: Collection; id: string } | null {
	const slash = key.indexOf("/");
	if (slash < 0) return null;
	const collection = key.slice(0, slash);
	if (!isCollection(collection)) return null;
	return { collection, id: key.slice(slash + 1) };
}

// ── Version order (last-write-wins with a deterministic tie-break) ──

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * JSON with object keys sorted at every level: equal content gives an equal
 * string whatever the key order. The server stores documents in this form.
 */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(value ?? null, (_key, inner: unknown) => {
		if (!isPlainObject(inner)) return inner;
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(inner).sort()) sorted[key] = inner[key];
		return sorted;
	});
}

/**
 * Compares two strings by code point, which is the UTF-8 byte order SQLite
 * uses for TEXT (JavaScript's `<` compares UTF-16 code units, which differs
 * for characters above U+FFFF against U+E000–U+FFFF).
 */
export function compareCodePoints(a: string, b: string): number {
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) {
		let x = a.charCodeAt(i);
		let y = b.charCodeAt(i);
		if (x === y) continue;
		// Surrogates (D800–DFFF) sort above E000–FFFF in code-point order.
		if (x >= 0xd800) x = x <= 0xdfff ? x + 0x2000 : x - 0x800;
		if (y >= 0xd800) y = y <= 0xdfff ? y + 0x2000 : y - 0x800;
		return x < y ? -1 : 1;
	}
	return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

/** Deep equality as JSON sees it (keys holding `undefined` are absent); a fast path only. */
function jsonEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false;
		return true;
	}
	const x = a as Record<string, unknown>;
	const y = b as Record<string, unknown>;
	let count = 0;
	for (const key in x) {
		if (x[key] === undefined) continue;
		count++;
		if (!jsonEqual(x[key], y[key])) return false;
	}
	for (const key in y) if (y[key] !== undefined) count--;
	return count === 0;
}

const versionStamp = (value: unknown): number =>
	isPlainObject(value) && typeof value.updatedAt === "number"
		? value.updatedAt
		: Number.NEGATIVE_INFINITY;

/**
 * The total order of two versions of one document (Amends §2.7, D45): the
 * greater `updatedAt` wins, and on an equal `updatedAt` the greater canonical
 * JSON (`canonicalJson`, by code point). Two writers can stamp the same
 * `updatedAt` (both edited a future-dated version: `stamp(prev)` gives
 * `prev + 1` on each), so the tie needs a winner every replica agrees on:
 * the store, other tabs, the persisted layout and the server (its UPSERT and
 * its conflicts) all use this order. 0 means the same content.
 */
export function compareVersions(a: unknown, b: unknown): number {
	if (a === b) return 0;
	const x = versionStamp(a);
	const y = versionStamp(b);
	if (x !== y) return x > y ? 1 : -1;
	if (jsonEqual(a, b)) return 0;
	return compareCodePoints(canonicalJson(a), canonicalJson(b));
}

/** Last-write-wins: does `incoming` replace `current` (`compareVersions`)? */
export function shouldReplace(
	current: { updatedAt: number } | undefined,
	incoming: { updatedAt: number },
): boolean {
	return !current || compareVersions(incoming, current) > 0;
}
