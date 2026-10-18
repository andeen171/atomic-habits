import { useActions, useHabits } from "@atomic/core/react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { Keyboard, ListPlus, Moon, Plus, Search, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/lib/messages";
import { useColorScheme } from "@/lib/theme";
import { useUI } from "@/lib/ui";
import { NAV, type NavKey } from "../layout/nav-items";
import { Kbd } from "../ui/kbd";

const GO_TO: NavKey[] = ["today", "habits", "tasks", "identity", "insights", "scorecard", "settings"];

/** ⌘K / Ctrl+K: actions, navigation and habits. */
export function CommandPalette() {
	const { t } = useT();
	const open = useUI((s) => s.paletteOpen);
	const setOpen = useUI((s) => s.setPaletteOpen);
	const openTaskDialog = useUI((s) => s.openTaskDialog);
	const setShortcutsOpen = useUI((s) => s.setShortcutsOpen);
	const navigate = useNavigate();
	const actions = useActions();
	const habits = useHabits();
	const scheme = useColorScheme();

	const run = (fn: () => void) => {
		setOpen(false);
		fn();
	};

	return (
		<DialogPrimitive.Root open={open} onOpenChange={setOpen}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
				<DialogPrimitive.Content className="fixed inset-x-3 top-3 z-50 mx-auto max-w-[600px] overflow-hidden rounded-xl border border-line bg-surface shadow-pop outline-none data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in md:top-[14vh]">
					<DialogPrimitive.Title className="sr-only">{t("shortcuts.palette")}</DialogPrimitive.Title>
					<DialogPrimitive.Description className="sr-only">{t("palette.placeholder")}</DialogPrimitive.Description>
					<Command loop className="flex max-h-[min(70dvh,520px)] flex-col">
						<div className="flex items-center gap-3 border-line border-b px-4">
							<Search className="size-[18px] shrink-0 text-ink-subtle" />
							<Command.Input
								autoFocus
								placeholder={t("palette.placeholder")}
								className="h-14 min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-subtle focus-visible:outline-none"
							/>
							<Kbd>Esc</Kbd>
						</div>
						<Command.List className="min-h-0 flex-1 overflow-y-auto p-2 [&_[cmdk-group-heading]]:section-label [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1.5">
							<Command.Empty className="py-10 text-center text-ink-muted text-small">{t("palette.empty")}</Command.Empty>
							<Command.Group heading={t("palette.actions")}>
								<PaletteItem icon={<Plus />} shortcut="H" onSelect={() => run(() => navigate({ to: "/habits/new" }))}>
									{t("shortcuts.newHabit")}
								</PaletteItem>
								<PaletteItem
									icon={<ListPlus />}
									shortcut="N"
									onSelect={() => run(() => openTaskDialog({ mode: "create", date: null }))}
								>
									{t("shortcuts.newTask")}
								</PaletteItem>
								<PaletteItem
									icon={scheme === "dark" ? <Sun /> : <Moon />}
									onSelect={() => run(() => actions.updateSettings({ theme: scheme === "dark" ? "light" : "dark" }))}
								>
									{t("palette.toggleTheme")}
								</PaletteItem>
								<PaletteItem icon={<Keyboard />} shortcut="?" onSelect={() => run(() => setShortcutsOpen(true))}>
									{t("shortcuts.help")}
								</PaletteItem>
							</Command.Group>
							<Command.Group heading={t("palette.navigate")}>
								{GO_TO.map((key) => {
									const Icon = NAV[key].icon;
									return (
										<PaletteItem key={key} icon={<Icon />} onSelect={() => run(() => navigate({ to: NAV[key].to }))}>
											{t(`nav.${key}`)}
										</PaletteItem>
									);
								})}
							</Command.Group>
							{habits.length ? (
								<Command.Group heading={t("palette.habits")}>
									{habits.map((habit) => (
										<PaletteItem
											key={habit.id}
											value={`habit ${habit.name} ${habit.id}`}
											icon={<span className="font-emoji text-base leading-none">{habit.emoji}</span>}
											onSelect={() => run(() => navigate({ to: "/habits/$habitId", params: { habitId: habit.id } }))}
										>
											{habit.name}
										</PaletteItem>
									))}
								</Command.Group>
							) : null}
						</Command.List>
					</Command>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

interface PaletteItemProps {
	icon: ReactNode;
	children: string;
	shortcut?: string;
	value?: string;
	onSelect(): void;
}

function PaletteItem({ icon, children, shortcut, value, onSelect }: PaletteItemProps) {
	return (
		<Command.Item
			value={value ?? children}
			onSelect={onSelect}
			className="flex h-11 cursor-pointer select-none items-center gap-3 rounded-md px-2.5 text-ink text-small data-[selected=true]:bg-hover [&_svg]:size-[18px] [&_svg]:text-ink-subtle"
		>
			<span className="grid w-5 shrink-0 place-items-center">{icon}</span>
			<span className="flex-1 truncate">{children}</span>
			{shortcut ? <Kbd>{shortcut}</Kbd> : null}
		</Command.Item>
	);
}
