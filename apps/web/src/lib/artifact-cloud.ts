import {
	type AtomicState,
	type AtomicStore,
	type Collection,
	type SyncRecord,
	serializedBytes,
	toDayKey,
} from "@atomic/core";
import { useSyncExternalStore } from "react";

/**
 * Persistence for the hosted Artifact build (spec §2.10, D24): each viewer's
 * data is kept in their private `data/users/<id>/` subtree of the artifact's
 * `db`, so it survives cleared browser storage and follows them across
 * devices. Local storage stays the instant first-paint cache; this layer
 * merges the cloud copy on open (last-write-wins per record, through
 * `applyRemote`) and writes back the documents that changed.
 *
 * Documents (each under 256 KiB; the database holds at most 25,000):
 * - `settings`: `{ settings }`.
 * - `<collection>-<n>` for habits, tasks, identities and scorecard: records
 *   sorted by `(createdAt, id)`, packed greedily into chunks of at most
 *   192 KiB of UTF-8 (`serializedBytes`).
 * - `m-YYYY-MM-<n>`: `{ items: { logs, taskLogs, trackerEntries, journal } }`
 *   for the records dated in that month, chunked the same way.
 * - Translations are not stored (the artifact has no translation).
 *
 * Legacy documents (v1: one `habits`/`tasks`/`identities`/`scorecard`
 * document each, and `logs-YYYY-MM`) are still read. Once their replacements
 * were written, they are overwritten with `{ items: {} }`, as are chunks left
 * over when a key's chunk count shrinks.
 *
 * Saving pauses (persistent banner `sync.cloudPaused`) on `invalid_argument`
 * or `quota_exceeded` and retries on the next change. Nothing is written
 * while the store is `partial`: what is missing locally must not overwrite
 * the cloud copy. Absent outside an Artifact viewer or for signed-out
 * visitors.
 */

interface DocSnapshot {
	id: string;
	exists: boolean;
	data(): Record<string, unknown> | undefined;
}

interface DocRef {
	set(data: Record<string, unknown>): Promise<void>;
}

interface CollectionRef {
	get(): Promise<{ docs: DocSnapshot[] }>;
	doc(id: string): DocRef;
}

interface Db {
	collection(path: string): CollectionRef;
}

interface UserNamespace {
	id(): Promise<string | null>;
}

interface DownloadsNamespace {
	save(request: { filename: string; data: string }): Promise<{ status: string }>;
}

interface ClaudeRuntime {
	use(name: string): Promise<unknown>;
}

const runtime = (): ClaudeRuntime | null =>
	(globalThis as { claude?: ClaudeRuntime }).claude ?? null;

/** Entity collections stored as `<collection>-<n>` chunks. */
const ENTITY_COLLECTIONS = ["habits", "tasks", "identities", "scorecard"] as const;
/** Dated collections stored together in `m-YYYY-MM-<n>` month chunks. */
const MONTH_COLLECTIONS = ["logs", "taskLogs", "trackerEntries", "journal"] as const;
type MonthCollection = (typeof MONTH_COLLECTIONS)[number];

/** Chunk budget in UTF-8 bytes (the document limit is 256 KiB). */
export const ARTIFACT_CHUNK_BYTES = 192 * 1024;
const WRITE_DELAY_MS = 1_500;
const EMPTY_BODY = { items: {} };
const EMPTY_JSON = JSON.stringify(EMPTY_BODY);

const ENTITY_CHUNK_RE = /^(habits|tasks|identities|scorecard)-(\d+)$/;
const MONTH_CHUNK_RE = /^m-(\d{4}-\d{2})-(\d+)$/;
const LEGACY_LOGS_RE = /^logs-\d{4}-\d{2}$/;

type Json = Record<string, unknown>;
type Docs = Map<string, Json>;

// ── Status (the splash while loading, the "Cloud saving paused" banner) ──

/**
 * - "connecting": loading the cloud copy (the app keeps its splash, so a new
 *   device doesn't start onboarding before its data arrives);
 * - "on": connected; "paused": the last save was refused (banner);
 * - "off": no cloud copy (not an artifact viewer, signed out, read-only).
 */
export type ArtifactCloudStatus = "off" | "connecting" | "on" | "paused";

/** The splash waits at most this long for the cloud copy. */
const CONNECT_TIMEOUT_MS = 5_000;

let status: ArtifactCloudStatus = "off";
const statusListeners = new Set<() => void>();

function setStatus(next: ArtifactCloudStatus): void {
	if (status === next) return;
	status = next;
	for (const listener of statusListeners) listener();
}

export function getArtifactCloudStatus(): ArtifactCloudStatus {
	return status;
}

export function subscribeArtifactCloudStatus(listener: () => void): () => void {
	statusListeners.add(listener);
	return () => {
		statusListeners.delete(listener);
	};
}

/** "off" outside the artifact (or without a cloud copy); see `ArtifactCloudStatus`. */
export function useArtifactCloudStatus(): ArtifactCloudStatus {
	return useSyncExternalStore(
		subscribeArtifactCloudStatus,
		getArtifactCloudStatus,
		getArtifactCloudStatus,
	);
}

// ── Building documents ──

const isJson = (value: unknown): value is Json => typeof value === "object" && value !== null;

const num = (value: unknown): number => (typeof value === "number" ? value : 0);

/** `(createdAt, id)`: new records land in the last chunk, so earlier chunks rarely change. */
function byCreation(a: [string, Json], b: [string, Json]): number {
	return num(a[1].createdAt) - num(b[1].createdAt) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}

/** The month (`YYYY-MM`) a dated record belongs to; records without a valid date use their stamp. */
function monthOf(record: Json): string {
	const date = record.date;
	if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date.slice(0, 7);
	const stamp = num(record.createdAt) || num(record.updatedAt);
	return toDayKey(stamp).slice(0, 7);
}

/**
 * Packs `[id, record]` pairs greedily into bodies of at most `limit` UTF-8
 * bytes (exactly as `JSON.stringify` writes them). A single record larger
 * than the budget gets a chunk of its own.
 */
function packEntities(entries: [string, Json][], limit: number): Json[] {
	const chunks: Json[] = [];
	const base = serializedBytes(EMPTY_BODY);
	let items: Json = {};
	let size = base;
	let count = 0;
	for (const [id, record] of entries) {
		// `"id":record`, plus a comma after the first item.
		const entry = serializedBytes(id) + 1 + serializedBytes(record);
		if (count && size + entry + 1 > limit) {
			chunks.push({ items });
			items = {};
			size = base;
			count = 0;
		}
		items[id] = record;
		size += entry + (count ? 1 : 0);
		count++;
	}
	if (count) chunks.push({ items });
	return chunks;
}

type MonthEntry = [MonthCollection, string, Json];

function emptyMonthItems(): Record<MonthCollection, Json> {
	return { logs: {}, taskLogs: {}, trackerEntries: {}, journal: {} };
}

/** Like `packEntities`, for one month's `{ items: { logs, taskLogs, trackerEntries, journal } }`. */
function packMonth(entries: MonthEntry[], limit: number): Json[] {
	const chunks: Json[] = [];
	const base = serializedBytes({ items: emptyMonthItems() });
	let items = emptyMonthItems();
	let size = base;
	let count = 0;
	const filled = new Set<MonthCollection>();
	for (const [collection, id, record] of entries) {
		const entry = serializedBytes(id) + 1 + serializedBytes(record);
		if (count && size + entry + (filled.has(collection) ? 1 : 0) > limit) {
			chunks.push({ items });
			items = emptyMonthItems();
			size = base;
			count = 0;
			filled.clear();
		}
		size += entry + (filled.has(collection) ? 1 : 0);
		items[collection][id] = record;
		filled.add(collection);
		count++;
	}
	if (count) chunks.push({ items });
	return chunks;
}

/** Every document this state is stored as (settings, entity chunks, month chunks). */
export function buildArtifactDocs(
	state: Pick<AtomicState, "data" | "settings">,
	limit = ARTIFACT_CHUNK_BYTES,
): Docs {
	const docs: Docs = new Map();
	docs.set("settings", { settings: state.settings });

	for (const collection of ENTITY_COLLECTIONS) {
		const entries = Object.entries(state.data[collection] as Record<string, unknown>)
			.filter((entry): entry is [string, Json] => isJson(entry[1]))
			.sort(byCreation);
		packEntities(entries, limit).forEach((body, n) => {
			docs.set(`${collection}-${n}`, body);
		});
	}

	const months = new Map<string, MonthEntry[]>();
	for (const collection of MONTH_COLLECTIONS) {
		const records = state.data[collection] as Record<string, unknown>;
		for (const [id, record] of Object.entries(records)) {
			if (!isJson(record)) continue;
			const month = monthOf(record);
			let list = months.get(month);
			if (!list) {
				list = [];
				months.set(month, list);
			}
			list.push([collection, id, record]);
		}
	}
	const order = (c: MonthCollection) => MONTH_COLLECTIONS.indexOf(c);
	for (const [month, entries] of months) {
		entries.sort(
			(a, b) =>
				order(a[0]) - order(b[0]) ||
				num(a[2].createdAt) - num(b[2].createdAt) ||
				(a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0),
		);
		packMonth(entries, limit).forEach((body, n) => {
			docs.set(`m-${month}-${n}`, body);
		});
	}
	return docs;
}

/** Documents this layer owns: its chunks and the legacy shards they replaced. */
function isManagedDoc(id: string): boolean {
	return (
		ENTITY_CHUNK_RE.test(id) ||
		MONTH_CHUNK_RE.test(id) ||
		LEGACY_LOGS_RE.test(id) ||
		(ENTITY_COLLECTIONS as readonly string[]).includes(id)
	);
}

// ── Reading documents ──

function pushItems(records: SyncRecord[], collection: Collection, items: unknown): void {
	if (!isJson(items)) return;
	for (const [id, entity] of Object.entries(items)) {
		if (!isJson(entity) || typeof entity.updatedAt !== "number") continue;
		records.push({
			collection,
			id,
			updatedAt: entity.updatedAt,
			deletedAt: typeof entity.deletedAt === "number" ? entity.deletedAt : null,
			data: entity,
		});
	}
}

/** Records and settings from the current documents and the legacy (v1) shards. */
export function recordsFromArtifactDocs(docs: readonly DocSnapshot[]): {
	records: SyncRecord[];
	settings: Json | null;
} {
	const records: SyncRecord[] = [];
	let settings: Json | null = null;
	for (const doc of docs) {
		const body = doc.exists ? doc.data() : undefined;
		if (!body) continue;
		const id = doc.id;
		if (id === "settings") {
			settings = isJson(body.settings) ? body.settings : null;
			continue;
		}
		if (MONTH_CHUNK_RE.test(id)) {
			const items = body.items;
			if (!isJson(items)) continue;
			for (const collection of MONTH_COLLECTIONS) pushItems(records, collection, items[collection]);
			continue;
		}
		const entity = ENTITY_CHUNK_RE.exec(id)?.[1] ?? id;
		if ((ENTITY_COLLECTIONS as readonly string[]).includes(entity)) {
			pushItems(records, entity as Collection, body.items);
		} else if (LEGACY_LOGS_RE.test(id)) {
			pushItems(records, "logs", body.items);
		}
	}
	return { records, settings };
}

// ── Connecting ──

function hydrated(store: AtomicStore): Promise<void> {
	if (store.getState().hydrated) return Promise.resolve();
	return new Promise((resolve) => {
		const unsubscribe = store.subscribe((state) => {
			if (!state.hydrated) return;
			unsubscribe();
			resolve();
		});
	});
}

const errorCode = (error: unknown): string | undefined => {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : undefined;
};

/** Connects the store to the viewer's private cloud copy, when available. */
export async function connectArtifactCloud(store: AtomicStore): Promise<boolean> {
	const claude = runtime();
	if (!claude) return false;
	setStatus("connecting");
	const giveUp = setTimeout(() => {
		if (status === "connecting") setStatus("off");
	}, CONNECT_TIMEOUT_MS);
	const connected = await openCloudCopy(claude, store).catch((error: unknown) => {
		console.warn("[atomic] Cloud copy unavailable", error);
		return null;
	});
	clearTimeout(giveUp);
	if (!connected) {
		setStatus("off");
		return false;
	}
	startSaving(store, connected.collection, connected.written);
	return true;
}

/** Reads the viewer's documents and merges them into the (hydrated) store. */
async function openCloudCopy(
	claude: ClaudeRuntime,
	store: AtomicStore,
): Promise<{ collection: CollectionRef; written: Map<string, string> } | null> {
	const [db, user] = (await Promise.all([claude.use("db"), claude.use("user")])) as [
		Db | null,
		UserNamespace | null,
	];
	if (!db || !user) return null;
	const uid = await user.id();
	if (!uid) return null;

	const collection = db.collection(`data/users/${uid}`);
	/** What each known document holds now (JSON), as last read or written. */
	const written = new Map<string, string>();

	// Records applied before hydration would be replaced by the persisted state.
	await hydrated(store);

	const snapshot = await collection.get();
	const { records, settings } = recordsFromArtifactDocs(snapshot.docs);
	for (const doc of snapshot.docs) {
		const body = doc.exists ? doc.data() : undefined;
		if (body) written.set(doc.id, JSON.stringify(body));
	}
	const { actions, settings: local } = store.getState();
	if (records.length) actions.applyRemote(records);
	if (settings && !local.onboarded && settings.onboarded === true) {
		actions.updateSettings(settings);
	}
	return { collection, written };
}

/** Writes changed documents back, debounced, for the rest of the session. */
function startSaving(
	store: AtomicStore,
	collection: CollectionRef,
	written: Map<string, string>,
): void {
	setStatus("on");
	let enabled = true;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let writing = false;
	let again = false;

	const write = async (id: string, json: string) => {
		await collection.doc(id).set(JSON.parse(json) as Json);
		written.set(id, json);
	};

	const flush = async () => {
		if (!enabled) return;
		// Hydration missed some stored keys: what is missing here must not
		// overwrite the cloud copy (D24). Writes resume once it clears.
		if (store.getState().partial) return;
		if (writing) {
			again = true;
			return;
		}
		writing = true;
		try {
			const docs = buildArtifactDocs(store.getState());
			for (const [id, body] of docs) {
				const json = JSON.stringify(body);
				if (written.get(id) !== json) await write(id, json);
			}
			// Every replacement is written: blank the legacy shards and the
			// chunks a shrinking key no longer uses.
			for (const [id, json] of [...written]) {
				if (docs.has(id) || json === EMPTY_JSON || !isManagedDoc(id)) continue;
				await write(id, EMPTY_JSON);
			}
			setStatus("on");
		} catch (error) {
			const code = errorCode(error);
			if (code === "unavailable" || code === "resource_exhausted") {
				again = true;
			} else if (code === "invalid_argument" || code === "quota_exceeded") {
				// Persistent banner; the next change tries again.
				setStatus("paused");
				console.warn("[atomic] Cloud saving paused", error);
			} else {
				// Read-only viewer or revoked access: stay local-only.
				enabled = false;
				setStatus("off");
				console.warn("[atomic] Cloud saving stopped", error);
			}
		} finally {
			writing = false;
			if (again && enabled) {
				again = false;
				schedule(WRITE_DELAY_MS * 2);
			}
		}
	};

	const schedule = (delay = WRITE_DELAY_MS) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			void flush();
		}, delay);
	};

	store.subscribe((next, prev) => {
		if (next.data !== prev.data || next.settings !== prev.settings || next.partial !== prev.partial)
			schedule();
	});
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden" && timer) {
			clearTimeout(timer);
			timer = null;
			void flush();
		}
	});
	// Upload anything that only exists on this device (and migrate legacy shards).
	schedule(0);
}

/** Offers a file through the viewer's download prompt (Artifact build). */
export async function saveThroughViewer(filename: string, data: string): Promise<boolean> {
	const claude = runtime();
	if (!claude) return false;
	const downloads = (await claude.use("downloads")) as DownloadsNamespace | null;
	if (!downloads) return false;
	try {
		await downloads.save({ filename, data });
		return true;
	} catch (error) {
		// The viewer declining is a normal outcome, not a failure to report.
		return errorCode(error) === "declined";
	}
}

export function isArtifactRuntime(): boolean {
	return runtime() !== null;
}
