import { CircleCheck, RotateCcw, Trash2 } from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { DateChips, PriorityPicker } from "@/components/tasks/task-fields";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { showToast } from "@/lib/ui-store";
import { useActions, useAtomic } from "@atomic/core/react";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

/** Task editor presented as a bottom sheet over the current screen. */
export default function TaskSheetRoute() {
	const t = useT();
	const actions = useActions();
	const { id } = useLocalSearchParams<{ id: string }>();
	const task = useAtomic((s) => (id ? s.data.tasks[id] : undefined));
	const current = task && !task.deletedAt ? task : undefined;
	// Keep the last version on screen while the sheet animates out after a delete.
	const [snapshot, setSnapshot] = useState(current);
	useEffect(() => {
		if (current) setSnapshot(current);
	}, [current]);
	const live = current ?? snapshot;
	const [open, setOpen] = useState(true);
	const [title, setTitle] = useState(live?.title ?? "");
	const [notes, setNotes] = useState(live?.notes ?? "");
	const committed = useRef(false);

	const commit = () => {
		if (!live || committed.current) return;
		const patch: { title?: string; notes?: string | null } = {};
		if (title.trim() && title.trim() !== live.title) patch.title = title;
		if ((notes.trim() || null) !== live.notes) patch.notes = notes;
		if (Object.keys(patch).length) actions.updateTask(live.id, patch);
	};

	const close = () => {
		commit();
		committed.current = true;
		setOpen(false);
	};

	// Unknown or already-deleted task (e.g. a stale deep link): just leave.
	useEffect(() => {
		if (!live) router.canGoBack() ? router.back() : router.replace("/tasks");
	}, [live]);

	useEffect(() => {
		if (!current && snapshot) setOpen(false);
	}, [current, snapshot]);

	return (
		<Sheet
			inline
			scroll
			open={open}
			onClose={close}
			onClosed={() => (router.canGoBack() ? router.back() : router.replace("/tasks"))}
			title={t.t("tasks.edit")}
			closeButton
			testID="task-sheet"
			footer={
				live ? (
					<View style={{ flexDirection: "row", gap: 10 }}>
						<Button
							label={t.t("common.delete")}
							icon={Trash2}
							variant="soft"
							size="lg"
							style={{ flex: 1 }}
							onPress={() => {
								const taskId = live.id;
								committed.current = true;
								actions.deleteTask(taskId);
								haptics.medium();
								showToast(t.t("tasks.deleted"), {
									action: { label: t.t("common.undo"), onPress: () => actions.restoreTask(taskId) },
								});
								setOpen(false);
							}}
							testID="task-delete"
						/>
						<Button
							label={live.completedAt ? t.t("habit.markUndone") : t.t("common.done")}
							icon={live.completedAt ? RotateCcw : CircleCheck}
							size="lg"
							style={{ flex: 1.4 }}
							onPress={() => {
								commit();
								committed.current = true;
								actions.toggleTask(live.id);
								haptics.light();
								if (!live.completedAt) showToast(t.t("tasks.completed"), { tone: "success" });
								setOpen(false);
							}}
							testID="task-toggle"
						/>
					</View>
				) : null
			}
		>
			{live ? (
				<View style={{ gap: 18, paddingBottom: 8 }}>
					<TextField
						value={title}
						onChangeText={setTitle}
						onBlur={commit}
						placeholder={t.t("tasks.titlePlaceholder")}
						size="lg"
						maxLength={280}
						accessibilityLabel={t.t("tasks.titlePlaceholder")}
						testID="task-title"
					/>
					<TextField
						label={t.t("tasks.notes")}
						value={notes}
						onChangeText={setNotes}
						onBlur={commit}
						placeholder={t.t("tasks.notesPlaceholder")}
						multiline
						maxLength={2000}
					/>
					<View style={{ gap: 8 }}>
						<Text variant="label">{t.t("tasks.date")}</Text>
						<DateChips
							value={live.date}
							onChange={(date) => actions.updateTask(live.id, { date })}
							bleed={20}
						/>
					</View>
					<View style={{ gap: 8 }}>
						<Text variant="label">{t.t("tasks.priority")}</Text>
						<PriorityPicker
							value={live.priority}
							onChange={(priority) => actions.updateTask(live.id, { priority })}
						/>
					</View>
				</View>
			) : null}
		</Sheet>
	);
}
