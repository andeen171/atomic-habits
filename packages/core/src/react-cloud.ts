import { useMemo, useSyncExternalStore } from "react";
import {
	type AccountBanner,
	type AccountController,
	type AccountControllerState,
	accountBanners,
} from "./account-controller";
import type { AiAvailability, AiClient } from "./ai-client";
import { type Completion, type CompletionField, complete, completionCorpusOf } from "./complete";
import type { Collection, Habit, Identity, ScorecardItem, Task } from "./model";
import { useAtomic, useLocale } from "./react-context";
import { type SyncBanner, type SyncController, syncBanners } from "./sync-controller";
import { type LocalizedText, localizedText } from "./translate";

export type { LocalizedText } from "./translate";

/**
 * Cloud hooks (spec §3.6, Annex C §3.6). React module: exported from
 * `react.ts` only (`useSyncState` lives there).
 *
 * - `useAccountState`: the account controller's state.
 * - `useCloudBanners`: what `CloudBanners` shows, most urgent first.
 * - `useCompletions`: on-device completion for a built-in text field.
 * - `useText`: user text in the content language (phrasebook, AI translations).
 * - `useAiAvailability`: the AI client's availability (sparkle, Beta badge).
 */

const NO_ACCOUNT: AccountControllerState = {
	server: null,
	account: null,
	status: "idle",
	error: null,
	refreshedAt: null,
};
const noop = () => () => {};
const noAccount = () => NO_ACCOUNT;

/** The account controller's state; signed-out state without a controller (artifact build). */
export function useAccountState(
	controller: AccountController | null | undefined,
): AccountControllerState {
	return useSyncExternalStore(
		controller ? controller.subscribe : noop,
		controller ? controller.getState : noAccount,
		controller ? controller.getState : noAccount,
	);
}

const NO_AI: AiAvailability = {
	status: "hidden",
	beta: false,
	suggest: false,
	translateFeature: false,
	translateOn: false,
	translating: false,
	quota: { suggest: null, translate: null },
	blockedUntil: { suggest: null, translate: null },
};
const noAi = () => NO_AI;

/**
 * The AI client's availability (Annex C §1.6): the sparkle shows when
 * `status !== "hidden"` and `suggest`; every AI surface shows "Beta" while
 * `beta`. Hidden without a client (artifact build).
 */
export function useAiAvailability(ai: AiClient | null | undefined): AiAvailability {
	return useSyncExternalStore(
		ai ? ai.subscribe : noop,
		ai ? ai.availability : noAi,
		ai ? ai.availability : noAi,
	);
}

export type CloudBanner = SyncBanner | AccountBanner;

/**
 * The banners `CloudBanners` renders (spec §5.9): local save failures,
 * session ended, sync quota, clock skew, outdated server, then email
 * verification and payment grace.
 */
export function useCloudBanners(
	sync: SyncController,
	account?: AccountController | null,
): readonly CloudBanner[] {
	const syncState = useSyncExternalStore(sync.subscribe, sync.getState, sync.getState);
	const accountState = useAccountState(account);
	return useMemo(
		() => [...syncBanners(syncState), ...(syncState.user ? accountBanners(accountState) : [])],
		[syncState, accountState],
	);
}

/** Habit fields whose text can be shown translated. */
export type HabitTextField =
	| "name"
	| "unit"
	| "cueLocation"
	| "stackAfter"
	| "bundle"
	| "twoMinute"
	| "reward"
	| "environment"
	| "why";

export interface TextApi {
	habit(habit: Habit, field: HabitTextField): string;
	identity(identity: Identity, field: "statement"): string;
	task(task: Task, field: "title"): string;
	scorecard(item: ScorecardItem, field: "label"): string;
	info(collection: Collection, entity: Record<string, unknown>, field: string): LocalizedText;
}

/**
 * Text of user documents in the content language (Annex C §1.8): the
 * original, the phrasebook's template counterpart, or a current AI
 * translation, following `settings.contentLanguage`. `info` also says where
 * the text came from, for the "Translated from …" marker. Never used for
 * the journal or tracker entries (D19).
 */
export function useText(): TextApi {
	const translations = useAtomic((s) => s.data.translations);
	const contentLanguage = useAtomic((s) => s.settings.contentLanguage);
	const locale = useLocale();
	return useMemo(() => {
		const info = (
			collection: Collection,
			entity: Record<string, unknown>,
			field: string,
		): LocalizedText =>
			localizedText({ collection, entity, field, locale, translations, contentLanguage });
		return {
			habit: (habit, field) => info("habits", habit, field).text,
			identity: (identity) => info("identities", identity, "statement").text,
			task: (task) => info("tasks", task, "title").text,
			scorecard: (item) => info("scorecard", item, "label").text,
			info,
		};
	}, [translations, contentLanguage, locale]);
}

const NO_COMPLETIONS: readonly Completion[] = [];

/**
 * On-device completions for a built-in text field (Annex C §1.7), best
 * first, at most 3. The corpus is shared and rebuilt only when habits,
 * identities, tasks, the scorecard or the locale change. Nothing with
 * `settings.typingSuggestions` off or `enabled: false` (e.g. while the
 * field is not focused).
 */
export function useCompletions(
	field: CompletionField,
	value: string,
	opts: { enabled?: boolean } = {},
): readonly Completion[] {
	const habits = useAtomic((s) => s.data.habits);
	const identities = useAtomic((s) => s.data.identities);
	const tasks = useAtomic((s) => s.data.tasks);
	const scorecard = useAtomic((s) => s.data.scorecard);
	const typing = useAtomic((s) => s.settings.typingSuggestions);
	const locale = useLocale();
	const enabled = typing && opts.enabled !== false;
	const corpus = useMemo(
		() => (enabled ? completionCorpusOf({ habits, identities, tasks, scorecard }, locale) : null),
		[enabled, habits, identities, tasks, scorecard, locale],
	);
	return useMemo(
		() => (corpus ? complete(corpus, field, value) : NO_COMPLETIONS),
		[corpus, field, value],
	);
}
