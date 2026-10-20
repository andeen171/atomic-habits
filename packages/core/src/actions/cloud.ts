import type { DayKey } from "../dates";
import {
	COLLECTIONS,
	type Collection,
	type EntityByCollection,
	type Translation,
	translationId,
} from "../model";
import type { SyncMeta } from "../persist-layout";
import type { CommitChanges, StoreInternals } from "../store";
import { CLOCK_SKEW_MS, parsePendingKey } from "../sync";
import type { TranslationJob } from "../translate";

/**
 * Cloud store actions (spec §3.1, Annex C §3.2), merged into `AtomicActions`.
 * They use only `StoreInternals`. Owner after Phase 1A: T5.
 */

/** A translated field: the job it answers, the target locale and the translated text. */
export type TranslationWrite = Omit<TranslationJob, "text"> & {
	locale: string;
	/** The translation (the job's `text` is the original). */
	text: string;
};

/** Collections whose text can be translated. Never the journal or tracker entries (D19). */
export const TRANSLATABLE_COLLECTIONS: readonly Collection[] = [
	"habits",
	"identities",
	"tasks",
	"scorecard",
];

const TRANSLATION_TEXT_MAX = 600;

export interface CloudActions {
	/**
	 * Merges AI translations into the deterministic translation documents
	 * (`translationId(collection, id, locale)`), one per target document and
	 * locale, stamped and pending. Fields whose text and `src` are unchanged
	 * are not rewritten. Writes for other collections (the journal, D19),
	 * empty texts and malformed hashes are ignored. Origin `"derived"`.
	 * Returns the number of documents written. A no-op while the state is
	 * `partial` (the stored translations it merges into may be missing).
	 */
	applyTranslations(writes: TranslationWrite[]): number;
	/** Tombstones every live translation (translation turned off). Origin `"derived"`. */
	clearTranslations(): void;
	/**
	 * Tombstones translations whose target document is deleted (spec §2.5
	 * "Translation target deleted"). A target that is missing locally is kept:
	 * after a partial pull it may simply not have arrived yet, and a deleted
	 * target always arrives as a tombstone, which prunes it then. Targets of
	 * collections this build doesn't know are kept too. Runs at most once per
	 * local day unless forced; returns the number tombstoned. A no-op while
	 * the state is `partial`.
	 */
	pruneTranslations(opts?: { force?: boolean }): number;
	/**
	 * Re-stamps pending records the server refused as `future-timestamp`:
	 * `updatedAt = max(at, 1)` for each listed pending key whose `updatedAt >
	 * at`. `at` is the corrected clock (spec §2.7). Origin `"derived"`.
	 */
	restampFuture(keys: string[], at: number): void;
	/** Blob hashes now known to be on the server for the signed-in account. */
	markBlobsUploaded(hashes: string[]): void;
	/** A blob the server refuses for good (413 that is not a quota, or 415). */
	markBlobUnuploadable(sha: string, code: "too-large" | "unsupported"): void;
	/**
	 * Server clock minus device clock. Stored, and applied by `stamp()`, only
	 * when `|ms| > CLOCK_SKEW_MS` (2 min); otherwise 0 (D45).
	 */
	setClockOffset(ms: number): void;
	/**
	 * Pending keys are recorded only while tracking (D57). The controller turns
	 * it on (then calls `markAllPending`) at sign-in, and off at sign-out or
	 * lost authentication, which also clears `pending`.
	 */
	setTracking(on: boolean): void;
}

export function createCloudActions(internals: StoreInternals): CloudActions {
	const syncMeta = () => internals.get().sync;
	const setSyncMeta = (patch: Partial<SyncMeta>) => internals.get().actions.setSyncMeta(patch);
	const translations = () => internals.get().data.translations;
	/** The local day `pruneTranslations` last ran (in memory). */
	let prunedOn: DayKey | null = null;

	/** Commits translation documents and returns how many the store kept. */
	const commitTranslations = (docs: Translation[]): number => {
		if (!docs.length) return 0;
		internals.commit({ translations: docs }, { origin: "derived" });
		const stored = translations();
		return docs.filter((doc) => stored[doc.id] === doc).length;
	};

	return {
		applyTranslations(writes) {
			if (internals.get().partial) return 0;
			type Group = {
				collection: string;
				id: string;
				locale: string;
				fields: Translation["fields"];
			};
			const groups = new Map<string, Group>();
			for (const write of writes) {
				if (!(TRANSLATABLE_COLLECTIONS as readonly string[]).includes(write.collection)) continue;
				const text = typeof write.text === "string" ? write.text.trim() : "";
				if (!text || typeof write.src !== "string" || write.src.length !== 8) continue;
				if (typeof write.id !== "string" || typeof write.field !== "string") continue;
				if (typeof write.locale !== "string" || write.locale.length < 2) continue;
				const docId = translationId(write.collection, write.id, write.locale);
				let group = groups.get(docId);
				if (!group) {
					group = { collection: write.collection, id: write.id, locale: write.locale, fields: {} };
					groups.set(docId, group);
				}
				group.fields[write.field] = {
					text: text.slice(0, TRANSLATION_TEXT_MAX),
					src: write.src,
				};
			}
			const docs: Translation[] = [];
			for (const [docId, group] of groups) {
				const current = translations()[docId];
				const live = current && !current.deletedAt ? current : undefined;
				const base = live?.fields ?? {};
				const changed = Object.entries(group.fields).some(
					([field, value]) => base[field]?.text !== value.text || base[field]?.src !== value.src,
				);
				if (live && !changed) continue;
				const t = internals.stamp(current);
				const doc = internals.validated("translations", {
					via: "ai",
					...current,
					id: docId,
					targetCollection: group.collection,
					targetId: group.id,
					locale: group.locale,
					fields: { ...base, ...group.fields },
					createdAt: current?.createdAt ?? t,
					updatedAt: t,
					deletedAt: null,
				});
				if (doc) docs.push(doc);
			}
			return commitTranslations(docs);
		},
		clearTranslations() {
			const at = internals.now();
			const docs = Object.values(translations())
				.filter((doc) => !doc.deletedAt)
				.map((doc) => ({ ...doc, deletedAt: at, updatedAt: internals.stamp(doc) }));
			commitTranslations(docs);
		},
		pruneTranslations(opts = {}) {
			if (internals.get().partial) return 0;
			const today = internals.today();
			if (!opts.force && prunedOn === today) return 0;
			prunedOn = today;
			const { data } = internals.get();
			const at = internals.now();
			const docs: Translation[] = [];
			for (const doc of Object.values(data.translations)) {
				if (doc.deletedAt) continue;
				const collection = doc.targetCollection as Collection;
				if (!(COLLECTIONS as readonly string[]).includes(collection)) continue;
				const target = (data[collection] as Record<string, { deletedAt: number | null }>)[
					doc.targetId
				];
				// Missing: not pulled yet (or never synced here); only a tombstone prunes.
				if (!target?.deletedAt) continue;
				docs.push({ ...doc, deletedAt: at, updatedAt: internals.stamp(doc) });
			}
			return commitTranslations(docs);
		},
		restampFuture(keys, at) {
			const { data, sync } = internals.get();
			const floor = Math.max(at, 1);
			const changes: Partial<Record<Collection, { updatedAt: number }[]>> = {};
			for (const key of new Set(keys)) {
				if (!sync.pending[key]) continue;
				const parsed = parsePendingKey(key);
				if (!parsed) continue;
				const entity = data[parsed.collection][parsed.id] as
					| EntityByCollection[Collection]
					| undefined;
				if (!entity || !(entity.updatedAt > floor)) continue;
				const list = changes[parsed.collection] ?? [];
				list.push({ ...entity, updatedAt: floor });
				changes[parsed.collection] = list;
			}
			if (Object.keys(changes).length) {
				internals.commit(changes as CommitChanges, { origin: "derived" });
			}
		},
		markBlobsUploaded(hashes) {
			const current = syncMeta().blobsUploaded;
			const missing = hashes.filter((sha) => !current[sha]);
			if (!missing.length) return;
			const blobsUploaded = { ...current };
			for (const sha of missing) blobsUploaded[sha] = true;
			setSyncMeta({ blobsUploaded });
		},
		markBlobUnuploadable(sha, code) {
			const current = syncMeta().blobsUnuploadable;
			if (current[sha] === code) return;
			setSyncMeta({ blobsUnuploadable: { ...current, [sha]: code } });
		},
		setClockOffset(ms) {
			const offset = Number.isFinite(ms) && Math.abs(ms) > CLOCK_SKEW_MS ? Math.round(ms) : 0;
			if (syncMeta().clockOffsetMs !== offset) setSyncMeta({ clockOffsetMs: offset });
		},
		setTracking(on) {
			const sync = syncMeta();
			if (on) {
				if (!sync.tracking) setSyncMeta({ tracking: true });
				return;
			}
			if (sync.tracking || Object.keys(sync.pending).length) {
				setSyncMeta({ tracking: false, pending: {} });
			}
		},
	};
}
