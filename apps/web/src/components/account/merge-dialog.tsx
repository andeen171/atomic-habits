import { useMergePrompt } from "@/lib/account";
import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { CloudDownload, Combine } from "lucide-react";
import { type ReactNode, type Ref, useRef } from "react";
import { Button } from "../ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "../ui/dialog";

/**
 * First sign-in on a device with data, when the account has data too (D37,
 * Annex C §1.2): "Merge both" (focused first), "Use only the account's
 * data" (destructive: it wipes this device's data, keeping settings) or
 * "Don't sign in". Escape and closing mean "Don't sign in". Owner: T5.
 */
export function MergeDialog() {
	const { t } = useT();
	const ask = useMergePrompt((s) => s.ask);
	const answer = useMergePrompt((s) => s.answer);
	const mergeRef = useRef<HTMLButtonElement>(null);
	// Keep the last count while the dialog animates out.
	const lastCount = useRef(0);
	if (ask) lastCount.current = ask.localCount;

	return (
		<Dialog open={!!ask} onOpenChange={(open) => !open && answer("cancel")}>
			<DialogContent
				size="sm"
				role="alertdialog"
				hideClose
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					mergeRef.current?.focus();
				}}
			>
				<DialogHeader
					title={t("account.mergeTitle")}
					description={t.tp("account.mergeBodyCount", lastCount.current)}
				/>
				<DialogBody className="flex flex-col gap-3 pt-2">
					<Choice
						ref={mergeRef}
						icon={<Combine />}
						title={t("account.mergeBoth")}
						hint={t("account.mergeBothHint")}
						onClick={() => answer("merge")}
					/>
					<Choice
						tone="danger"
						icon={<CloudDownload />}
						title={t("account.mergeUseAccount")}
						hint={t("account.mergeUseAccountHint")}
						onClick={() => answer("replace")}
					/>
				</DialogBody>
				<DialogFooter className="border-t-0 pt-1">
					<Button variant="ghost" onClick={() => answer("cancel")} className="w-full sm:w-auto">
						{t("account.mergeCancel")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function Choice({
	ref,
	tone = "default",
	icon,
	title,
	hint,
	onClick,
}: {
	ref?: Ref<HTMLButtonElement>;
	tone?: "default" | "danger";
	icon: ReactNode;
	title: string;
	hint: string;
	onClick(): void;
}) {
	return (
		<button
			ref={ref}
			type="button"
			onClick={onClick}
			className={cn(
				"flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors duration-(--atomic-duration-fast)",
				tone === "danger"
					? "border-line hover:border-danger/50 hover:bg-danger-soft"
					: "border-accent/40 bg-accent-soft/40 hover:border-accent hover:bg-accent-soft",
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"grid size-9 shrink-0 place-items-center rounded-full [&_svg]:size-[18px]",
					tone === "danger" ? "bg-danger-soft text-danger" : "bg-surface text-accent-text",
				)}
			>
				{icon}
			</span>
			<span className="min-w-0">
				<span
					className={cn(
						"block font-semibold text-body",
						tone === "danger" ? "text-danger" : "text-ink",
					)}
				>
					{title}
				</span>
				<span className="mt-0.5 block text-ink-muted text-small">{hint}</span>
			</span>
		</button>
	);
}
