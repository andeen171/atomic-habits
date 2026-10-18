import { useT } from "@/lib/messages";
import type { ReactNode } from "react";
import { Button } from "./button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "./dialog";

interface ConfirmDialogProps {
	open: boolean;
	onOpenChange(open: boolean): void;
	title: ReactNode;
	body: ReactNode;
	confirmLabel: string;
	destructive?: boolean;
	onConfirm(): void;
}

export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	body,
	confirmLabel,
	destructive,
	onConfirm,
}: ConfirmDialogProps) {
	const { t } = useT();
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent size="sm" hideClose role="alertdialog">
				<DialogHeader title={title} />
				<DialogBody className="pt-1 text-ink-muted">{body}</DialogBody>
				<DialogFooter className="border-t-0">
					<Button variant="secondary" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button
						variant={destructive ? "destructive" : "primary"}
						onClick={() => {
							onConfirm();
							onOpenChange(false);
						}}
					>
						{confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
