import { accountController } from "@/lib/account";
import { useT } from "@/lib/messages";
import {
	type AtomicData,
	COLLECTIONS,
	type Collection,
	type MessageKey,
	accountErrorKey,
} from "@atomic/core";
import { useActions, useAtomic } from "@atomic/core/react";
import { ChevronDown, Download } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { SettingsRow, SettingsSection } from "../settings/settings-section";
import { Button } from "../ui/button";
import { Spinner } from "./account-ui";

/**
 * Account page → Your data (Annex C §1.1; D49, D69): "Download account
 * data" (a single-use, 10-minute link to a ZIP of everything on the
 * server, photos included), then the changes the server refused and the
 * items a newer version of Atomic wrote, so nothing fails silently.
 * Owner: T5.
 */
export function DataCard() {
	const { t } = useT();
	const [exporting, setExporting] = useState(false);
	const rejected = useAtomic((s) => s.sync.rejected);
	const superseded = useAtomic((s) => s.sync.superseded);
	const data = useAtomic((s) => s.data);
	const actions = useActions();

	const exportAccount = async () => {
		setExporting(true);
		try {
			await accountController.exportAccount();
			toast.success(t("account.exportStarted"));
		} catch (error) {
			toast.error(t(accountErrorKey(error)));
		} finally {
			setExporting(false);
		}
	};

	// The log repeats a key every round it's refused: newest first, once each.
	const refused = useMemo(() => {
		const seen = new Map<string, { key: string; code: string; at: number }>();
		for (const entry of rejected) seen.set(entry.key, entry);
		return [...seen.values()].sort((a, b) => b.at - a.at);
	}, [rejected]);
	const newer = useMemo(() => Object.entries(superseded).sort((a, b) => b[1] - a[1]), [superseded]);

	return (
		<SettingsSection id="data" title={t("settings.data")}>
			<SettingsRow label={t("account.export")} hint={t("account.exportHint")} stack>
				<Button
					variant="secondary"
					size="sm"
					disabled={exporting}
					onClick={() => void exportAccount()}
				>
					{exporting ? <Spinner /> : <Download />}
					{t("account.export")}
				</Button>
			</SettingsRow>
			{refused.length ? (
				<RecordList
					title={t.tp("sync.rejectedCount", refused.length)}
					hint={t("sync.rejectedHint")}
					action={
						<Button variant="ghost" size="sm" onClick={() => actions.setSyncMeta({ rejected: [] })}>
							{t("sync.clearList")}
						</Button>
					}
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
			) : null}
			{newer.length ? (
				<RecordList title={t.tp("sync.supersededCount", newer.length)} hint={t("sync.superseded")}>
					{newer.map(([key]) => (
						<RecordItem key={key} pendingKey={key} data={data} />
					))}
				</RecordList>
			) : null}
		</SettingsSection>
	);
}

type T = ReturnType<typeof useT>["t"];

function rejectReason(code: string, t: T): string {
	const key = `sync.reject.${code}` as MessageKey;
	return t.has(key) ? t(key) : t("sync.reject.invalid");
}

function RecordList({
	title,
	hint,
	action,
	children,
}: {
	title: string;
	hint: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<details className="group px-5 py-4">
			<summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-md [&::-webkit-details-marker]:hidden">
				<span className="min-w-0">
					<span className="block font-medium text-ink text-small">{title}</span>
					<span className="mt-0.5 block text-ink-muted text-small">{hint}</span>
				</span>
				<ChevronDown
					aria-hidden="true"
					className="mt-0.5 size-4 shrink-0 text-ink-muted transition-transform duration-(--atomic-duration-fast) group-open:rotate-180 motion-reduce:transition-none"
				/>
			</summary>
			<ul className="mt-3 divide-y divide-line rounded-lg border border-line">{children}</ul>
			{action ? <div className="mt-2 flex justify-end">{action}</div> : null}
		</details>
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
	const { t } = useT();
	const { label, name } = describeRecord(pendingKey, data, t);
	return (
		<li className="flex flex-col gap-0.5 px-3.5 py-2.5 text-small sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
			<span className="min-w-0 break-words text-ink">{name ?? label}</span>
			<span className="shrink-0 text-ink-muted">
				{[name ? label : null, detail].filter(Boolean).join(" · ")}
			</span>
		</li>
	);
}

const isCollection = (value: string): value is Collection =>
	(COLLECTIONS as readonly string[]).includes(value);

/** "Read 10 pages" (Habit), "Read 10 pages · Oct 17" (Habit day), else the collection. */
function describeRecord(
	pendingKey: string,
	data: AtomicData,
	t: T,
): { label: string; name: string | null } {
	const slash = pendingKey.indexOf("/");
	const collection = slash > 0 ? pendingKey.slice(0, slash) : pendingKey;
	const id = slash > 0 ? pendingKey.slice(slash + 1) : "";
	const labelKey = `sync.collection.${collection}` as MessageKey;
	const label = t.has(labelKey) ? t(labelKey) : t("sync.collection.unknown");
	if (!isCollection(collection)) return { label, name: null };
	const entity = (data[collection] as Record<string, Record<string, unknown>>)[id];
	if (!entity) return { label, name: null };
	const text = (value: unknown) =>
		typeof value === "string" && value.trim() ? value.trim() : null;
	const day = (value: unknown) =>
		typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
			? t.formatDayShort(value as `${number}-${number}-${number}`)
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
			return { label, name: join(t.has(kindKey) ? t(kindKey) : null, day(entity.date)) };
		}
		default:
			return { label, name: null };
	}
}
