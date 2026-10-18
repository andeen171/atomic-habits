import type { AtomicState, AtomicStore, Collection, HabitLog, SyncRecord } from "@atomic/core";

/**
 * Persistence for the hosted Artifact build: each viewer's data is kept in
 * their private `data/users/<id>/` subtree of the artifact's `db`, so it
 * survives cleared browser storage and follows them across devices.
 * localStorage stays the instant first-paint cache; this layer merges the
 * cloud copy on open (last-write-wins per entity) and writes back changed
 * shards. Absent outside an Artifact viewer or for signed-out visitors.
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

const ENTITY_SHARDS = ["habits", "tasks", "identities", "scorecard"] as const;
const WRITE_DELAY_MS = 1_500;

type Shards = Map<string, Record<string, unknown>>;

function buildShards(state: AtomicState): Shards {
	const shards: Shards = new Map();
	shards.set("settings", { settings: state.settings });
	for (const collection of ENTITY_SHARDS) {
		shards.set(collection, { items: state.data[collection] });
	}
	const months = new Map<string, Record<string, HabitLog>>();
	for (const log of Object.values(state.data.logs)) {
		const key = `logs-${log.date.slice(0, 7)}`;
		let bucket = months.get(key);
		if (!bucket) {
			bucket = {};
			months.set(key, bucket);
		}
		bucket[log.id] = log;
	}
	for (const [key, items] of months) shards.set(key, { items });
	return shards;
}

function recordsFrom(docs: DocSnapshot[]): {
	records: SyncRecord[];
	settings: Record<string, unknown> | null;
} {
	const records: SyncRecord[] = [];
	let settings: Record<string, unknown> | null = null;
	for (const doc of docs) {
		const body = doc.exists ? doc.data() : undefined;
		if (!body) continue;
		if (doc.id === "settings") {
			settings = (body.settings as Record<string, unknown> | undefined) ?? null;
			continue;
		}
		const collection: Collection | null = doc.id.startsWith("logs-")
			? "logs"
			: (ENTITY_SHARDS as readonly string[]).includes(doc.id)
				? (doc.id as Collection)
				: null;
		if (!collection) continue;
		const items = (body.items ?? {}) as Record<string, Record<string, unknown>>;
		for (const [id, entity] of Object.entries(items)) {
			if (typeof entity?.updatedAt !== "number") continue;
			records.push({
				collection,
				id,
				updatedAt: entity.updatedAt,
				deletedAt: typeof entity.deletedAt === "number" ? entity.deletedAt : null,
				data: entity,
			});
		}
	}
	return { records, settings };
}

/** Connects the store to the viewer's private cloud copy, when available. */
export async function connectArtifactCloud(store: AtomicStore): Promise<boolean> {
	const claude = runtime();
	if (!claude) return false;
	const [db, user] = (await Promise.all([claude.use("db"), claude.use("user")])) as [
		Db | null,
		UserNamespace | null,
	];
	if (!db || !user) return false;
	const uid = await user.id();
	if (!uid) return false;

	const collection = db.collection(`data/users/${uid}`);
	const written = new Map<string, string>();

	try {
		const snapshot = await collection.get();
		const { records, settings } = recordsFrom(snapshot.docs);
		for (const doc of snapshot.docs) {
			const body = doc.exists ? doc.data() : undefined;
			if (body) written.set(doc.id, JSON.stringify(body));
		}
		const { actions, settings: local } = store.getState();
		if (records.length) actions.applyRemote(records);
		if (settings && !local.onboarded && settings.onboarded === true) {
			actions.updateSettings(settings);
		}
	} catch (error) {
		console.warn("[atomic] Cloud copy unavailable", error);
		return false;
	}

	let enabled = true;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let writing = false;
	let again = false;

	const flush = async () => {
		if (!enabled) return;
		if (writing) {
			again = true;
			return;
		}
		writing = true;
		try {
			for (const [id, body] of buildShards(store.getState())) {
				const json = JSON.stringify(body);
				if (written.get(id) === json) continue;
				await collection.doc(id).set(JSON.parse(json) as Record<string, unknown>);
				written.set(id, json);
			}
		} catch (error) {
			const code = (error as { code?: string } | null)?.code;
			if (code === "unavailable" || code === "resource_exhausted") {
				again = true;
			} else {
				// Read-only viewer, quota or revoked access: stay local-only.
				enabled = false;
				console.warn("[atomic] Cloud saving paused", error);
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
		if (next.data !== prev.data || next.settings !== prev.settings) schedule();
	});
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden" && timer) {
			clearTimeout(timer);
			timer = null;
			void flush();
		}
	});
	// Upload anything that only exists on this device.
	schedule(0);
	return true;
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
		const code = (error as { code?: string } | null)?.code;
		// The viewer declining is a normal outcome, not a failure to report.
		return code === "declined";
	}
}

export function isArtifactRuntime(): boolean {
	return runtime() !== null;
}
