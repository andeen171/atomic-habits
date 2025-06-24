import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Habit } from "@/types/Habits";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./ui/dialog";
import { Label } from "./ui/label";

type Props = {
	editingHabit: Habit;
	isDialogOpen: boolean;
	setIsDialogOpen: (value: boolean) => void;
	setEditingHabit: (habit: Habit) => void;
	saveEditedHabit: () => void;
};

export default function EditHabitDialog({
	editingHabit,
	isDialogOpen,
	setIsDialogOpen,
	setEditingHabit,
	saveEditedHabit,
}: Props) {
	return (
		<Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit Habit</DialogTitle>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label className="font-medium text-sm">Name</Label>
						<Input
							value={editingHabit.name}
							onChange={(e) =>
								setEditingHabit({ ...editingHabit, name: e.target.value })
							}
						/>
					</div>

					<div className="space-y-2">
						<Label className="font-medium text-sm">Type</Label>
						<div className="flex gap-4">
							<label className="flex items-center gap-2">
								<input
									type="radio"
									checked={editingHabit.type === "boolean"}
									onChange={() =>
										setEditingHabit({
											...editingHabit,
											type: "boolean",
											target: 1,
										})
									}
									className="h-4 w-4"
								/>
								<span>Yes/No</span>
							</label>
							<label className="flex items-center gap-2">
								<input
									type="radio"
									checked={editingHabit.type === "countable"}
									onChange={() =>
										setEditingHabit({ ...editingHabit, type: "countable" })
									}
									className="h-4 w-4"
								/>
								<span>Countable</span>
							</label>
						</div>
					</div>

					{editingHabit.type === "countable" && (
						<div className="space-y-2">
							<Label className="font-medium text-sm">Target Count</Label>
							<Input
								type="number"
								min="1"
								value={editingHabit.target}
								onChange={(e) =>
									setEditingHabit({
										...editingHabit,
										target: Number.parseInt(e.target.value) || 1,
									})
								}
							/>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => setIsDialogOpen(false)}>
						Cancel
					</Button>
					<Button onClick={saveEditedHabit}>Save Changes</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
