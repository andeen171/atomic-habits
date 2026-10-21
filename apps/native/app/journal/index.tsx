import { EmptyState } from "@/components/empty-state";
import { Lock, Pin, Plus, Vote } from "@/components/icons";
import { EntryCard } from "@/components/journal/entry-card";
import {
	type JournalFilterPatch,
	type JournalFilterState,
	JournalFilters,
} from "@/components/journal/journal-filters";
import { JournalTimeline } from "@/components/journal/journal-timeline";
import { PrincipleQuote } from "@/components/principles/principle-quote";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Screen, ScreenTitle } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	type JournalEntry,
	type JournalFilter,
	type JournalTimelineKind,
	isJournalKind,
} from "@atomic/core";
import { useIdentities, useJournalTimeline } from "@atomic/core/react";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, type TextInput, View, findNodeHandle } from "react-native";

/** Route params (Annex J §5): timeline filters. */
export type JournalIndexParams = {
	identityId?: string;
	habitId?: string;
	/** A journal kind or "dayNote"; several, comma-separated. */
	kind?: string;
};

const EVERYTHING: JournalFilter = {};
/** Pinned cards shown before "+N more". */
const PINNED_SHOWN = 3;

const idParam = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : undefined;

const isTimelineKind = (value: string): value is JournalTimelineKind =>
	value === "dayNote" || isJournalKind(value);

/** The valid kinds of a `kind` parameter, deduplicated, in the order given. */
function parseKinds(value: unknown): JournalTimelineKind[] {
	if (typeof value !== "string") return [];
	return [...new Set(value.split(",").map((part) => part.trim()))].filter(isTimelineKind);
}

function fromParams(params: JournalIndexParams): JournalFilterState {
	return {
		identity: idParam(params.identityId),
		habit: idParam(params.habitId),
		kinds: parseKinds(params.kind),
	};
}

/**
 * The Journal (Annex J §1.10, §5): the "small wins" principle (D60), search
 * and filters (seeded by the route's params, so "See all" links land
 * filtered), the pinned strip, then every entry and v1 day note in one
 * timeline grouped by month. Day notes open the note sheet, so they stay
 * editable here. Owner: T3.
 */
export default function JournalScreen() {
	const t = useT();
	const styles = useStyles();
	const { colors } = useTheme();
	const params = useLocalSearchParams<JournalIndexParams>();
	const [state, setState] = useState<JournalFilterState>(() => fromParams(params));
	const searchRef = useRef<TextInput>(null);

	// New params on this screen (a link from elsewhere): start from them.
	const paramsKey = `${params.identityId ?? ""}|${params.habitId ?? ""}|${params.kind ?? ""}`;
	const seeded = useRef(paramsKey);
	useEffect(() => {
		if (seeded.current === paramsKey) return;
		seeded.current = paramsKey;
		setState(
			fromParams({ identityId: params.identityId, habitId: params.habitId, kind: params.kind }),
		);
	}, [paramsKey, params.identityId, params.habitId, params.kind]);

	const filter = useMemo<JournalFilter>(
		() => ({
			identityId: state.identity,
			habitId: state.habit,
			kinds: state.kinds,
			query: state.q,
		}),
		[state],
	);
	const everything = useJournalTimeline(EVERYTHING);
	const hasIdentity = useIdentities().length > 0;
	const items = useJournalTimeline(filter);
	const pinned = useMemo(
		() => items.flatMap((item) => (item.type === "entry" && item.entry.pinned ? [item.entry] : [])),
		[items],
	);

	const update = (patch: JournalFilterPatch) =>
		setState((prev) => {
			const next: JournalFilterState = { ...prev };
			if ("identity" in patch) next.identity = patch.identity;
			if ("habit" in patch) next.habit = patch.habit;
			if ("q" in patch) next.q = patch.q;
			if (patch.kinds) next.kinds = patch.kinds;
			return next;
		});

	// "Clear filters" goes away once used: screen readers land on the search box (no keyboard).
	const clear = () => {
		setState({ kinds: [] });
		setTimeout(() => {
			const node = searchRef.current ? findNodeHandle(searchRef.current) : null;
			if (node == null) return;
			try {
				AccessibilityInfo.setAccessibilityFocus(node);
			} catch {
				// Not supported on this platform (the web preview).
			}
		}, 250);
	};

	const newEntry = () => router.push("/journal/editor");

	return (
		<Screen
			back
			title={t.t("journal.title")}
			right={
				<Button
					label={t.t("journal.new")}
					icon={Plus}
					size="sm"
					variant="ink"
					onPress={newEntry}
					testID="journal-new"
				/>
			}
			testID="journal-screen"
		>
			<ScreenTitle title={t.t("journal.title")} subtitle={t.t("journal.subtitle")} />
			<PrincipleQuote id="small-wins" variant="card" style={styles.quote} />

			{everything.length === 0 ? (
				<Card style={styles.block}>
					<EmptyState
						compact
						title={t.t("journal.empty")}
						body={t.t("journal.emptyBody")}
						testID="journal-empty"
						action={
							// Evidence needs an identity; without one, start from the kind picker.
							hasIdentity ? (
								<Button
									label={t.t("journal.emptyCta")}
									icon={Vote}
									onPress={() =>
										router.push({ pathname: "/journal/editor", params: { kind: "evidence" } })
									}
									testID="journal-empty-cta"
								/>
							) : (
								<Button
									label={t.t("journal.new")}
									icon={Plus}
									onPress={newEntry}
									testID="journal-empty-cta"
								/>
							)
						}
					/>
				</Card>
			) : (
				<>
					<JournalFilters
						value={state}
						onChange={update}
						onClear={clear}
						resultCount={items.length}
						searchRef={searchRef}
					/>
					<View style={styles.results}>
						{items.length ? (
							<>
								<PinnedStrip entries={pinned} />
								{/* A new filter starts the list from its first page. */}
								<JournalTimeline
									key={JSON.stringify(filter)}
									items={items}
									hideHabit={!!state.habit}
									impliedIdentityId={
										state.identity && state.identity !== "none" ? state.identity : undefined
									}
								/>
							</>
						) : (
							<Card>
								<EmptyState
									compact
									title={t.t("journal.noMatches")}
									testID="journal-no-matches"
									action={
										<Button
											label={t.t("journal.filter.clear")}
											variant="secondary"
											onPress={clear}
										/>
									}
								/>
							</Card>
						)}
					</View>
				</>
			)}

			<View style={styles.privacy}>
				<Lock size={14} color={colors.textMuted} strokeWidth={2} style={styles.privacyIcon} />
				<View style={styles.privacyText}>
					<Text variant="small" tone="muted">
						{t.t("journal.privacy")}
					</Text>
					<PressableScale
						onPress={() => router.push("/account")}
						accessibilityRole="link"
						hitSlop={10}
						style={styles.privacyLink}
						testID="journal-sync-link"
					>
						<Text variant="small" weight="semibold" tone="accent">
							{t.t("sync.journal")}
						</Text>
					</PressableScale>
				</View>
			</View>
		</Screen>
	);
}

/**
 * Pinned entries that match the filters (Annex J §1.10): up to three, then
 * "+N more" / "Show less". They stay in the timeline too.
 */
function PinnedStrip({ entries }: { entries: readonly JournalEntry[] }) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const [expanded, setExpanded] = useState(false);
	if (!entries.length) return null;
	const shown = expanded ? entries : entries.slice(0, PINNED_SHOWN);
	const more = entries.length - PINNED_SHOWN;
	return (
		<View style={styles.pinned} testID="journal-pinned">
			<View style={styles.pinnedHeader}>
				<Pin size={12} color={colors.textSubtle} strokeWidth={2.4} />
				<Text variant="label" accessibilityRole="header">
					{t.t("journal.pinned")}
				</Text>
			</View>
			<View style={styles.pinnedList}>
				{shown.map((entry) => (
					<EntryCard
						key={entry.id}
						entry={entry}
						lines={3}
						showPin={false}
						testID={`journal-pinned-${entry.id}`}
					/>
				))}
			</View>
			{more > 0 ? (
				<Button
					label={
						expanded ? t.t("journal.pinned.less") : t.t("journal.pinned.more", { count: more })
					}
					variant="ghost"
					size="sm"
					onPress={() => setExpanded(!expanded)}
					style={styles.pinnedMore}
				/>
			) : null}
		</View>
	);
}

const useStyles = makeStyles(() => ({
	quote: { marginBottom: 24 },
	block: { marginBottom: 8 },
	results: { marginTop: 24 },
	pinned: { marginBottom: 32 },
	pinnedHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
	pinnedList: { gap: 10 },
	pinnedMore: { alignSelf: "flex-start", marginTop: 6, marginLeft: -8 },
	privacy: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 40 },
	privacyIcon: { marginTop: 2 },
	privacyText: { flex: 1, gap: 6 },
	privacyLink: { alignSelf: "flex-start" },
}));
