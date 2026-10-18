import { useToday } from "@atomic/core/react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, ListPlus, Orbit } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/lib/messages";
import { useUI } from "@/lib/ui";
import { Dialog, DialogBody, DialogContent, DialogHeader } from "../ui/dialog";

/** Mobile ⊕: choose between a new habit and a new task. */
export function CreateSheet() {
	const { t, at } = useT();
	const open = useUI((s) => s.createSheetOpen);
	const setOpen = useUI((s) => s.setCreateSheetOpen);
	const openTaskDialog = useUI((s) => s.openTaskDialog);
	const navigate = useNavigate();
	const today = useToday();

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent size="sm">
				<DialogHeader title={at("create.title")} />
				<DialogBody className="flex flex-col gap-2 pb-6">
					<CreateOption
						icon={<Orbit />}
						title={t("habits.new")}
						body={at("create.habitHint")}
						onClick={() => {
							setOpen(false);
							void navigate({ to: "/habits/new" });
						}}
					/>
					<CreateOption
						icon={<ListPlus />}
						title={t("shortcuts.newTask")}
						body={at("create.taskHint")}
						onClick={() => {
							setOpen(false);
							openTaskDialog({ mode: "create", date: today });
						}}
					/>
				</DialogBody>
			</DialogContent>
		</Dialog>
	);
}

interface CreateOptionProps {
	icon: ReactNode;
	title: string;
	body: string;
	onClick(): void;
}

function CreateOption({ icon, title, body, onClick }: CreateOptionProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex items-center gap-4 rounded-lg border border-line bg-surface p-4 text-left transition-colors hover:bg-hover"
		>
			<span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent [&_svg]:size-5">
				{icon}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block font-semibold text-ink">{title}</span>
				<span className="block text-ink-muted text-small">{body}</span>
			</span>
			<ChevronRight className="size-4 text-ink-subtle" />
		</button>
	);
}
