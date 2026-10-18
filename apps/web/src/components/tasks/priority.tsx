import type { TaskPriority } from "@atomic/core";
import { habitColor } from "@atomic/core/theme";
import { Flag } from "lucide-react";
import { useColorScheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** high = danger, medium = warning, low = muted sky. */
export function usePriorityColor(priority: TaskPriority): string {
	const scheme = useColorScheme();
	if (priority === 3) return "var(--danger)";
	if (priority === 2) return "var(--warning)";
	if (priority === 1) return habitColor("sky", scheme).text;
	return "var(--text-subtle)";
}

export function PriorityFlag({ priority, className }: { priority: TaskPriority; className?: string }) {
	const color = usePriorityColor(priority);
	return (
		<Flag
			aria-hidden
			className={cn("size-3.5 shrink-0", className)}
			style={{ color, fill: priority > 0 ? color : "none", fillOpacity: 0.2 }}
		/>
	);
}
