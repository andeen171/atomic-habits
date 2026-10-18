import { useReturnFocus } from "@/lib/focus";
import { useT } from "@/lib/messages";
import { useColorScheme } from "@/lib/theme";
import { useUI } from "@/lib/ui";
import { useActions, useHabits } from "@atomic/core/react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { Keyboard, ListPlus, Moon, Plus, Search, Sun } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { NAV, type NavKey } from "../layout/nav-items";
import { Kbd } from "../ui/kbd";

const GO_TO: NavKey[] = [
	"today",
	"habits",
	"tasks",
	"identity",
	"insights",
	"scorecard",
	"settings",
];

type PaletteGroup = "actions" | "navigate" | "habits";

interface PaletteEntry {
	id: string;
	group: PaletteGroup;
	label: string;
	icon: ReactNode;
	shortcut?: string;
	run(): void;
}

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/**
 * Rank a label against the query: exact, then prefix, then word prefix, then
 * substring. No fuzzy subsequences — "read" must not match "Scorecard".
 */
function paletteScore(label: string, query: string): number {
	const l = fold(label);
	const q = fold(query);
	if (!q) return 1;
	if (l === q) return 5;
	if (l.startsWith(q)) return 4;
	const words = l.split(/[\s\-–—·/()]+/).filter(Boolean);
	if (words.some((word) => word.startsWith(q))) return 3;
	const tokens = q.split(/\s+/).filter(Boolean);
	if (tokens.length > 1 && tokens.every((tok) => words.some((word) => word.startsWith(tok)))) {
		return 2.5;
	}
	return l.includes(q) ? 2 : 0;
}

/** ⌘K / Ctrl+K: actions, navigation and habits. */
export function CommandPalette() {
	const { t, at } = useT();
	const open = useUI((s) => s.paletteOpen);
	const setOpen = useUI((s) => s.setPaletteOpen);
	const openTaskDialog = useUI((s) => s.openTaskDialog);
	const setShortcutsOpen = useUI((s) => s.setShortcutsOpen);
	const navigate = useNavigate();
	const actions = useActions();
	const habits = useHabits();
	const scheme = useColorScheme();
	const focus = useReturnFocus();
	const [search, setSearch] = useState("");

	const entries = useMemo<PaletteEntry[]>(
		() => [
			{
				id: "action:new-habit",
				group: "actions",
				label: t("shortcuts.newHabit"),
				icon: <Plus />,
				shortcut: "H",
				run: () => void navigate({ to: "/habits/new" }),
			},
			{
				id: "action:new-task",
				group: "actions",
				label: t("shortcuts.newTask"),
				icon: <ListPlus />,
				shortcut: "N",
				run: () => openTaskDialog({ mode: "create", date: null }),
			},
			{
				id: "action:theme",
				group: "actions",
				label: t("palette.toggleTheme"),
				icon: scheme === "dark" ? <Sun /> : <Moon />,
				run: () => actions.updateSettings({ theme: scheme === "dark" ? "light" : "dark" }),
			},
			{
				id: "action:shortcuts",
				group: "actions",
				label: t("shortcuts.help"),
				icon: <Keyboard />,
				shortcut: "?",
				run: () => setShortcutsOpen(true),
			},
			...GO_TO.map((key): PaletteEntry => {
				const Icon = NAV[key].icon;
				return {
					id: `nav:${key}`,
					group: "navigate",
					label: t(`nav.${key}`),
					icon: <Icon />,
					run: () => void navigate({ to: NAV[key].to }),
				};
			}),
			...habits.map(
				(habit): PaletteEntry => ({
					id: `habit:${habit.id}`,
					group: "habits",
					label: habit.name,
					icon: <span className="font-emoji text-base leading-none">{habit.emoji}</span>,
					run: () => void navigate({ to: "/habits/$habitId", params: { habitId: habit.id } }),
				}),
			),
		],
		[t, navigate, openTaskDialog, actions, scheme, setShortcutsOpen, habits],
	);

	const query = search.trim();
	/** Searching shows one list, best match first, so Enter opens what was typed. */
	const ranked = useMemo(
		() =>
			query
				? entries
						.map((entry, index) => ({ entry, index, score: paletteScore(entry.label, query) }))
						.filter((item) => item.score > 0)
						.sort((a, b) => b.score - a.score || a.index - b.index)
						.map((item) => item.entry)
				: [],
		[entries, query],
	);

	// Start fresh every time (it can also be closed by the ⌘K toggle).
	useEffect(() => {
		if (!open) setSearch("");
	}, [open]);

	const run = (entry: PaletteEntry) => {
		setOpen(false);
		entry.run();
	};

	const headings: Record<PaletteGroup, string> = {
		actions: t("palette.actions"),
		navigate: t("palette.navigate"),
		habits: t("palette.habits"),
	};

	return (
		<DialogPrimitive.Root open={open} onOpenChange={setOpen}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
				<DialogPrimitive.Content
					{...focus}
					className="fixed inset-x-3 top-3 z-50 mx-auto max-w-[600px] overflow-hidden rounded-xl border border-line bg-surface shadow-pop outline-none data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in md:top-[14vh]"
				>
					<DialogPrimitive.Title className="sr-only">
						{t("shortcuts.palette")}
					</DialogPrimitive.Title>
					<DialogPrimitive.Description className="sr-only">
						{t("palette.placeholder")}
					</DialogPrimitive.Description>
					<Command
						loop
						shouldFilter={false}
						label={t("shortcuts.palette")}
						className="flex max-h-[min(70dvh,520px)] flex-col"
					>
						<div className="flex items-center gap-3 border-line border-b px-4">
							<Search className="size-[18px] shrink-0 text-ink-subtle" />
							<Command.Input
								value={search}
								onValueChange={setSearch}
								placeholder={t("palette.placeholder")}
								className="h-14 min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-subtle focus-visible:outline-none"
							/>
							<Kbd>Esc</Kbd>
						</div>
						<Command.List
							label={at("palette.results")}
							className="[&_[cmdk-group-heading]]:section-label min-h-0 flex-1 overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1.5"
						>
							<Command.Empty className="py-10 text-center text-ink-muted text-small">
								{t("palette.empty")}
							</Command.Empty>
							{query ? (
								ranked.map((entry) => (
									<PaletteItem key={entry.id} entry={entry} onSelect={() => run(entry)} />
								))
							) : (
								<>
									{(["actions", "navigate", "habits"] as const).map((group) => {
										const items = entries.filter((entry) => entry.group === group);
										if (!items.length) return null;
										return (
											<Command.Group key={group} heading={headings[group]}>
												{items.map((entry) => (
													<PaletteItem key={entry.id} entry={entry} onSelect={() => run(entry)} />
												))}
											</Command.Group>
										);
									})}
								</>
							)}
						</Command.List>
					</Command>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

function PaletteItem({ entry, onSelect }: { entry: PaletteEntry; onSelect(): void }) {
	return (
		<Command.Item
			value={entry.id}
			onSelect={onSelect}
			className="flex h-11 cursor-pointer select-none items-center gap-3 rounded-md px-2.5 text-ink text-small data-[selected=true]:bg-hover [&_svg]:size-[18px] [&_svg]:text-ink-subtle"
		>
			<span className="grid w-5 shrink-0 place-items-center">{entry.icon}</span>
			<span className="flex-1 truncate">{entry.label}</span>
			{entry.shortcut ? <Kbd>{entry.shortcut}</Kbd> : null}
		</Command.Item>
	);
}
