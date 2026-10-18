import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

interface DialogContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
	/** Hide the corner close button (e.g. when the footer already has one). */
	hideClose?: boolean;
	size?: "sm" | "md" | "lg";
}

const sizes = { sm: "md:max-w-[420px]", md: "md:max-w-[560px]", lg: "md:max-w-[720px]" };

/**
 * Bottom sheet on mobile (grabber, xxl radius), centered dialog on desktop
 * (xl radius, max 560px). Both sit on the palette scrim.
 */
export function DialogContent({
	className,
	children,
	hideClose,
	size = "md",
	...props
}: DialogContentProps) {
	const { t } = useT();
	return (
		<DialogPrimitive.Portal>
			<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
			<DialogPrimitive.Content
				className={cn(
					"fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col overflow-hidden rounded-t-2xl border border-line border-b-0 bg-surface shadow-pop outline-none",
					"data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in",
					"md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-h-[86dvh] md:w-[calc(100%-48px)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:border-b",
					"md:data-[state=closed]:animate-pop-out md:data-[state=open]:animate-pop-in",
					sizes[size],
					className,
				)}
				{...props}
			>
				<div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-line-strong md:hidden" />
				{children}
				{hideClose ? null : (
					<DialogPrimitive.Close
						aria-label={t("common.close")}
						className="absolute top-4 right-4 hidden size-8 items-center justify-center rounded-full text-ink-subtle transition-colors hover:bg-hover hover:text-ink md:inline-flex"
					>
						<X className="size-[18px]" />
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	);
}

interface DialogHeaderProps {
	title: ReactNode;
	description?: ReactNode;
	className?: string;
}

export function DialogHeader({ title, description, className }: DialogHeaderProps) {
	return (
		<div className={cn("px-5 pt-4 pb-1 md:px-6 md:pt-6 md:pr-14", className)}>
			<DialogPrimitive.Title className="font-semibold text-h3 text-ink">{title}</DialogPrimitive.Title>
			{description ? (
				<DialogPrimitive.Description className="mt-1 text-ink-muted text-small">
					{description}
				</DialogPrimitive.Description>
			) : (
				<DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
			)}
		</div>
	);
}

export function DialogBody({ className, ...props }: ComponentProps<"div">) {
	return <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4 md:px-6", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"flex shrink-0 flex-col-reverse gap-2 border-line border-t px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-end md:px-6 md:pb-4",
				className,
			)}
			{...props}
		/>
	);
}
