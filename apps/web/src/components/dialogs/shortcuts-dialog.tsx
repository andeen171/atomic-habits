import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import { isMac } from "@/lib/utils";
import { Fragment, type ReactNode } from "react";
import { Dialog, DialogBody, DialogContent, DialogHeader } from "../ui/dialog";
import { Kbd } from "../ui/kbd";

function useShortcutList() {
	const { t, at } = useT();
	const then = at("shortcuts.then");
	const rows: { label: string; keys: ReactNode[] }[] = [
		{ label: t("shortcuts.palette"), keys: [isMac ? "⌘" : "Ctrl", "K"] },
		{ label: t("shortcuts.newHabit"), keys: ["H"] },
		{ label: t("shortcuts.newTask"), keys: ["N"] },
		{ label: t("shortcuts.newEntry"), keys: ["J"] },
		{ label: t("shortcuts.goToday"), keys: ["G", then, "T"] },
		{ label: t("shortcuts.goHabits"), keys: ["G", then, "H"] },
		{ label: t("shortcuts.goTasks"), keys: ["G", then, "K"] },
		{ label: t("shortcuts.goJournal"), keys: ["G", then, "J"] },
		{ label: t("shortcuts.prevDay"), keys: ["←"] },
		{ label: t("shortcuts.nextDay"), keys: ["→"] },
		{ label: t("shortcuts.help"), keys: ["?"] },
		{ label: at("shortcuts.close"), keys: ["Esc"] },
	];
	return { rows, then };
}

export function ShortcutList() {
	const { rows, then } = useShortcutList();
	return (
		<dl className="divide-y divide-line">
			{rows.map((row) => (
				<div key={row.label} className="flex items-center justify-between gap-4 py-2.5">
					<dt className="text-ink text-small">{row.label}</dt>
					<dd className="flex shrink-0 items-center gap-1">
						{row.keys.map((key, i) => (
							<Fragment key={`${row.label}-${i}`}>
								{key === then ? (
									<span className="px-0.5 text-ink-subtle text-tiny">{key}</span>
								) : (
									<Kbd>{key}</Kbd>
								)}
							</Fragment>
						))}
					</dd>
				</div>
			))}
		</dl>
	);
}

export function ShortcutsDialog() {
	const { t } = useT();
	const open = useUI((s) => s.shortcutsOpen);
	const setOpen = useUI((s) => s.setShortcutsOpen);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent size="sm">
				<DialogHeader title={t("settings.shortcuts")} />
				<DialogBody className="pt-1 pb-6">
					<ShortcutList />
				</DialogBody>
			</DialogContent>
		</Dialog>
	);
}
