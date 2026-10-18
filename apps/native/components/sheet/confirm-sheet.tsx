import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";
import { Sheet } from "./sheet";

export interface ConfirmSheetProps {
	open: boolean;
	title: string;
	body?: string;
	confirmLabel: string;
	destructive?: boolean;
	onConfirm: () => void;
	onClose: () => void;
}

/** Confirmation for irreversible actions (everything else uses undo toasts). */
export function ConfirmSheet({
	open,
	title,
	body,
	confirmLabel,
	destructive,
	onConfirm,
	onClose,
}: ConfirmSheetProps) {
	const t = useT();
	return (
		<Sheet open={open} onClose={onClose} title={title}>
			{body ? (
				<Text tone="muted" style={{ marginBottom: 20 }}>
					{body}
				</Text>
			) : null}
			<View style={{ gap: 10 }}>
				<Button
					label={confirmLabel}
					variant={destructive ? "destructive" : "primary"}
					size="lg"
					onPress={() => {
						onConfirm();
						onClose();
					}}
					testID="confirm-button"
				/>
				<Button label={t.t("common.cancel")} variant="ghost" size="lg" onPress={onClose} />
			</View>
		</Sheet>
	);
}
