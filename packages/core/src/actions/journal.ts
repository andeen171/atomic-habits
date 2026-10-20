import { createId } from "../ids";
import {
	type Collection,
	JOURNAL_ANSWERS_MAX,
	JOURNAL_ANSWER_MAX,
	JOURNAL_TEXT_MAX,
	type JournalContract,
	type JournalEntry,
	PROMPT_ID_RE,
	type Settings,
	journalEntrySchema,
} from "../model";
import type { StoreInternals } from "../store";

/**
 * Journal store actions (Annex J §3.3, spec §3.1), merged into
 * `AtomicActions`. They use only `StoreInternals`. Owner after Phase 1A: T3.
 *
 * Privacy (D19): the journal syncs like any collection, except that a
 * device can keep its entries to itself with the device-local "Sync journal"
 * switch (`settings.syncJournal`). While it is off the store still records
 * journal keys as pending (so turning it back on uploads what was written
 * meanwhile), and the sync engine keeps them on the device: they are neither
 * pushed nor counted as pending or held back (`localOnlyCollections`).
 * Entries from other devices keep arriving. The journal is never sent to AI
 * or translation (`ai.ts` has no journal kind; `applyTranslations` refuses it).
 *
 * Deleting a habit or an identity never rewrites journal entries.
 */

type Editable<T> = Omit<T, "id" | "createdAt" | "updatedAt" | "deletedAt">;
export type JournalInput = Partial<Editable<JournalEntry>> & { kind: string };
export type JournalPatch = Partial<Editable<JournalEntry>>;

export interface JournalActions {
	/**
	 * Creates an entry (`journalEntrySchema.parse`: throws on invalid input,
	 * like `createTask`). `date` defaults to today; with `identityId`
	 * undefined and a `habitId`, the habit's identity is copied when it is
	 * live. Answers go through `sanitizeJournalAnswers`.
	 */
	createJournalEntry(input: JournalInput): JournalEntry;
	/**
	 * Edits an entry (stamped strictly newer). `kind` is fixed after creation,
	 * and so is `habitId` for recovery, check-in and contract entries. A
	 * signed contract is locked: only `pinned` changes until the signature is
	 * revoked. The signature and the outcome have their own actions.
	 */
	updateJournalEntry(id: string, patch: JournalPatch): void;
	deleteJournalEntry(id: string): void;
	restoreJournalEntry(id: string): void;
	/**
	 * Signs a contract (`signedAt = now`): only a live `contract` entry with a
	 * habit, a non-empty commitment and consequence and an end date. Returns
	 * whether it signed (false when incomplete or already signed).
	 */
	signContract(id: string): boolean;
	/** Clears the signature so the contract can be edited again. */
	revokeContractSignature(id: string): void;
	/** Kept or broken (null clears); only on a signed contract. */
	setContractOutcome(id: string, outcome: "kept" | "broken" | null): void;
}

/** Kinds whose habit can't change once the entry exists (Annex J §1.2). */
const HABIT_LOCKED_KINDS: ReadonlySet<string> = new Set(["recovery", "checkin", "contract"]);

/** Drops a trailing high surrogate a cut left behind. */
function cut(text: string, max: number): string {
	if (text.length <= max) return text;
	const sliced = text.slice(0, max);
	const last = sliced.charCodeAt(sliced.length - 1);
	return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced;
}

/**
 * The store's generic answer sanitizer (spec §3.4; the backstop behind the
 * per-prompt `sanitizeAnswers` of `journal.ts`): CRLF → LF, trimmed, empty
 * answers and ids that are not prompt ids dropped, each answer at most
 * `JOURNAL_ANSWER_MAX`, at most `JOURNAL_ANSWERS_MAX` answers, and the last
 * answers clamped so the total stays within `JOURNAL_TEXT_MAX`.
 */
export function sanitizeJournalAnswers(answers: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	if (!answers || typeof answers !== "object" || Array.isArray(answers)) return out;
	let count = 0;
	let total = 0;
	for (const [id, raw] of Object.entries(answers as Record<string, unknown>)) {
		if (count >= JOURNAL_ANSWERS_MAX || total >= JOURNAL_TEXT_MAX) break;
		if (!PROMPT_ID_RE.test(id) || typeof raw !== "string") continue;
		let value = raw.replace(/\r\n?/g, "\n").trim();
		if (!value) continue;
		value = cut(value, Math.min(JOURNAL_ANSWER_MAX, JOURNAL_TEXT_MAX - total));
		if (!value) continue;
		out[id] = value;
		count++;
		total += value.length;
	}
	return out;
}

/** Collections this device keeps to itself: the journal while "Sync journal" is off (D19). */
export function localOnlyCollections(settings: Pick<Settings, "syncJournal">): Collection[] {
	return settings.syncJournal === false ? ["journal"] : [];
}

const clean = (value: string | null | undefined): string | null => {
	if (value == null) return null;
	const trimmed = value.trim();
	return trimmed.length ? trimmed : null;
};

/** A contract as written: partner cleaned. */
function cleanContract(contract: unknown): unknown {
	if (!contract || typeof contract !== "object") return contract;
	const partner = (contract as { partner?: unknown }).partner;
	return {
		...(contract as object),
		...(typeof partner === "string" || partner == null
			? { partner: clean(partner as string | null | undefined) }
			: {}),
	};
}

const filled = (value: unknown) => typeof value === "string" && value.trim().length > 0;

export function createJournalActions(internals: StoreInternals): JournalActions {
	const data = () => internals.get().data;

	/** A live entry, or undefined. */
	const liveEntry = (id: string): JournalEntry | undefined => {
		const entry = data().journal[id];
		return entry && !entry.deletedAt ? entry : undefined;
	};

	const write = (current: JournalEntry, changes: Partial<JournalEntry>): void => {
		const next = internals.validated("journal", {
			...current,
			...changes,
			id: current.id,
			updatedAt: internals.stamp(current),
		});
		if (next) internals.commit({ journal: [next] });
	};

	/** The habit's identity when that identity is live (Annex J §1.2). */
	const identityOfHabit = (habitId: string | null | undefined): string | null => {
		const habit = habitId ? data().habits[habitId] : undefined;
		const identityId = habit?.identityId;
		const identity = identityId ? data().identities[identityId] : undefined;
		return identity && !identity.deletedAt ? identity.id : null;
	};

	return {
		createJournalEntry(input) {
			const t = internals.stamp();
			const habitId = input.habitId ?? null;
			const raw = {
				...input,
				kind: typeof input.kind === "string" ? input.kind.trim() : input.kind,
				date: input.date ?? internals.today(),
				habitId,
				identityId: input.identityId !== undefined ? input.identityId : identityOfHabit(habitId),
				answers: sanitizeJournalAnswers(input.answers ?? {}),
				contract: input.contract == null ? null : cleanContract(input.contract),
				id: createId(),
				createdAt: t,
				updatedAt: t,
				deletedAt: null,
			};
			const parsed = journalEntrySchema.parse(raw);
			const entry = { ...raw, ...parsed } as JournalEntry;
			internals.commit({ journal: [entry] });
			return entry;
		},

		updateJournalEntry(id, patch) {
			const current = liveEntry(id);
			if (!current) return;
			const signed = current.contract?.signedAt != null;
			const changes: Partial<JournalEntry> = {};
			for (const [key, value] of Object.entries(patch) as [keyof JournalPatch, unknown][]) {
				if (key === "kind") continue; // fixed at creation
				if (signed && key !== "pinned") continue; // a signed contract is locked
				if (key === "habitId" && HABIT_LOCKED_KINDS.has(current.kind)) continue;
				if (key === "answers") {
					changes.answers = sanitizeJournalAnswers(value);
				} else if (key === "contract") {
					if (value == null) {
						changes.contract = null;
					} else if (typeof value === "object") {
						// The signature and the outcome have their own actions.
						const { signedAt: _s, outcome: _o, ...terms } = value as Partial<JournalContract>;
						changes.contract = cleanContract({
							...(current.contract ?? {}),
							...terms,
							signedAt: current.contract?.signedAt ?? null,
							outcome: current.contract?.outcome ?? null,
						}) as JournalContract;
					}
				} else {
					(changes as Record<string, unknown>)[key] = value;
				}
			}
			if (!Object.keys(changes).length) return;
			write(current, changes);
		},

		deleteJournalEntry(id) {
			const current = liveEntry(id);
			if (current) write(current, { deletedAt: internals.now() });
		},

		restoreJournalEntry(id) {
			const current = data().journal[id];
			if (current?.deletedAt) write(current, { deletedAt: null });
		},

		signContract(id) {
			const current = liveEntry(id);
			const contract = current?.contract;
			if (!current || current.kind !== "contract" || !contract) return false;
			if (contract.signedAt != null || !current.habitId || !contract.until) return false;
			if (!filled(current.answers.commitment) || !filled(current.answers.consequence)) return false;
			write(current, { contract: { ...contract, signedAt: internals.now() } });
			return data().journal[id]?.contract?.signedAt != null;
		},

		revokeContractSignature(id) {
			const current = liveEntry(id);
			const contract = current?.contract;
			if (!current || !contract || contract.signedAt == null) return;
			write(current, { contract: { ...contract, signedAt: null } });
		},

		setContractOutcome(id, outcome) {
			const current = liveEntry(id);
			const contract = current?.contract;
			if (!current || current.kind !== "contract" || !contract || contract.signedAt == null) return;
			if (contract.outcome === outcome) return;
			write(current, { contract: { ...contract, outcome } });
		},
	};
}
