import { ChevronDown, Download } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { SectionLabel } from "@/components/ui/section-label";
import { Text } from "@/components/ui/text";
import { accountController } from "@/lib/account";
import { haptics } from "@/lib/haptics";
import { type AppTranslator, useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import {
	type AtomicData,
	COLLECTIONS,
	type Collection,
	type DayKey,
	type MessageKey,
	accountErrorKey,
} from "@atomic/core";
import { useActions, useAtomic } from "@atomic/core/react";
import { type ReactNode, useMemo, useState } from "react";
import { View } from "react-native";
import { CardRow, Divider } from "./account-ui";

/** Downloads the account archive (D69); shared with the delete sheet's "Want a copy first?". */
export function useAccountExport() {
	const t = useT();
	const [exporting, setExporting] = useState(false);
	const run = async () => {
		if (exporting) return;
		setExporting(true);
		try {
			await accountController.exportAccount();
		} catch (error) {
			haptics.warning();
			showToast(t.t(accountErrorKey(error)), { tone: "danger" });
		} finally {
			setExporting(false);
		}
	};
	return { exporting, run };
}

/**
 * Account → Your data (Annex C §1.1, §5; D49, D69): "Download account data"
 * (a single-use, 10-minute link to a ZIP of everything on the server,
 * photos included, saved through the share sheet), then the changes the
 * server refused and the items a newer version of Atomic wrote, so nothing
 * fails silently. Owner: T5.
 */
export function DataSection() {
	const t = useT();
	const styles = useStyles();
	const { exporting, run } = useAccountExport();
	const rejected = useAtomic((s) => s.sync.rejected);
	const superseded = useAtomic((s) => s.sync.superseded);
	const data = useAtomic((s) => s.data);
	const actions = useActions();

	// The log repeats a key every round it's refused: newest first, once each.
	const refused = useMemo(() => {
		const seen = new Map<string, { key: string; code: string; at: number }>();
		for (const entry of rejected) seen.set(entry.key, entry);
		return [...seen.values()].sort((a, b) => b.at - a.at);
	}, [rejected]);
	const newer = useMemo(() => Object.entries(superseded).sort((a, b) => b[1] - a[1]), [superseded]);

	return (
		<>
			<SectionLabel>{t.t("settings.data")}</SectionLabel>
			<Card padding={0} style={styles.block} testID="data-section">
				<CardRow title={t.t("account.export")} hint={t.t("account.exportHint")}>
					<Button
						label={t.t("account.export")}
						icon={Download}
						variant="secondary"
						size="sm"
						loading={exporting}
						onPress={() => void run()}
						style={styles.start}
						testID="data-export"
					/>
				</CardRow>
				{refused.length ? (
					<>
						<Divider />
						<RecordList
							title={t.tp("sync.rejectedCount", refused.length)}
							hint={t.t("sync.rejectedHint")}
							action={
								<Button
									label={t.t("sync.clearList")}
									variant="ghost"
									size="sm"
									onPress={() => {
										haptics.selection();
										actions.setSyncMeta({ rejected: [] });
									}}
									style={styles.end}
								/>
							}
							testID="data-rejected"
						>
							{refused.map((entry) => (
								<RecordItem
									key={entry.key}
									pendingKey={entry.key}
									data={data}
									detail={rejectReason(entry.code, t)}
								/>
							))}
						</RecordList>
					</>
				) : null}
				{newer.length ? (
					<>
						<Divider />
						<RecordList
							title={t.tp("sync.supersededCount", newer.length)}
							hint={t.t("sync.superseded")}
							testID="data-superseded"
						>
							{newer.map(([key]) => (
								<RecordItem key={key} pendingKey={key} data={data} />
							))}
						</RecordList>
					</>
				) : null}
			</Card>
		</>
	);
}

function rejectReason(code: string, t: AppTranslator): string {
	const key = `sync.reject.${code}` as MessageKey;
	return t.has(key) ? t.t(key) : t.t("sync.reject.invalid");
}

function RecordList({
	title,
	hint,
	action,
	children,
	testID,
}: {
	title: string;
	hint: string;
	action?: ReactNode;
	children: ReactNode;
	testID?: string;
}) {
	const { colors } = useTheme();
	const styles = useStyles();
	const [open, setOpen] = useState(false);
	return (
		<View style={styles.list} testID={testID}>
			<PressableScale
				scaleTo={0.99}
				onPress={() => {
					haptics.selection();
					setOpen((v) => !v);
				}}
				accessibilityRole="button"
				accessibilityLabel={`${title}. ${hint}`}
				accessibilityState={{ expanded: open }}
				style={styles.listHead}
			>
				<View style={styles.listText}>
					<Text weight="medium">{title}</Text>
					<Text variant="small" tone="muted">
						{hint}
					</Text>
				</View>
				<ChevronDown
					size={18}
					color={colors.textMuted}
					style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}
				/>
			</PressableScale>
			{open ? (
				<>
					<View style={[styles.items, { borderColor: colors.border }]}>{children}</View>
					{action}
				</>
			) : null}
		</View>
	);
}

function RecordItem({
	pendingKey,
	data,
	detail,
}: {
	pendingKey: string;
	data: AtomicData;
	detail?: string;
}) {
	const t = useT();
	const styles = useStyles();
	const { label, name } = describeRecord(pendingKey, data, t);
	const meta = [name ? label : null, detail].filter(Boolean).join(" · ");
	return (
		<View style={styles.item} accessible accessibilityLabel={[name ?? label, meta].join(", ")}>
			<Text variant="small">{name ?? label}</Text>
			{meta ? (
				<Text variant="small" tone="muted">
					{meta}
				</Text>
			) : null}
		</View>
	);
}

const isCollection = (value: string): value is Collection =>
	(COLLECTIONS as readonly string[]).includes(value);

/** "Read 10 pages" (Habit), "Read 10 pages · Oct 17" (Habit day), else the collection. */
function describeRecord(
	pendingKey: string,
	data: AtomicData,
	t: AppTranslator,
): { label: string; name: string | null } {
	const slash = pendingKey.indexOf("/");
	const collection = slash > 0 ? pendingKey.slice(0, slash) : pendingKey;
	const id = slash > 0 ? pendingKey.slice(slash + 1) : "";
	const labelKey = `sync.collection.${collection}` as MessageKey;
	const label = t.has(labelKey) ? t.t(labelKey) : t.t("sync.collection.unknown");
	if (!isCollection(collection)) return { label, name: null };
	const entity = (data[collection] as Record<string, Record<string, unknown>>)[id];
	if (!entity) return { label, name: null };
	const text = (value: unknown) =>
		typeof value === "string" && value.trim() ? value.trim() : null;
	const day = (value: unknown) =>
		typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
			? t.formatDayShort(value as DayKey)
			: null;
	const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(" · ") || null;
	switch (collection) {
		case "habits":
			return { label, name: text(entity.name) };
		case "tasks":
			return { label, name: text(entity.title) };
		case "identities":
			return { label, name: text(entity.statement) };
		case "scorecard":
			return { label, name: text(entity.label) };
		case "logs":
		case "trackerEntries": {
			const habit = data.habits[String(entity.habitId)];
			return { label, name: join(text(habit?.name), day(entity.date ?? entity.day)) };
		}
		case "taskLogs": {
			const task = data.tasks[String(entity.taskId)];
			return { label, name: join(text(task?.title), day(entity.date)) };
		}
		case "journal": {
			const kindKey = `journal.kind.${String(entity.kind)}` as MessageKey;
			return { label, name: join(t.has(kindKey) ? t.t(kindKey) : null, day(entity.date)) };
		}
		default:
			return { label, name: null };
	}
}

const useStyles = makeStyles((t) => ({
	block: { marginBottom: 24 },
	start: { alignSelf: "flex-start" },
	end: { alignSelf: "flex-end" },
	list: { paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
	listHead: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
	listText: { flex: 1, gap: 2 },
	items: { borderWidth: 1, borderRadius: t.radii.md, overflow: "hidden" },
	item: {
		gap: 2,
		paddingHorizontal: 14,
		paddingVertical: 10,
		borderBottomWidth: 1,
		borderBottomColor: t.colors.border,
		marginBottom: -1,
	},
}));
