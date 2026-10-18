import { type ComponentProps, type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";

const controlBase =
	"w-full rounded-md border border-line bg-sunken/60 px-3.5 text-body text-ink transition-[border-color,box-shadow,background-color] duration-(--atomic-duration-fast) placeholder:text-ink-subtle hover:border-line-strong focus-visible:border-accent focus-visible:bg-surface focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/15 disabled:opacity-60 aria-invalid:border-danger";

export function Input({ className, ...props }: ComponentProps<"input">) {
	return <input className={cn(controlBase, "h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
	return <textarea className={cn(controlBase, "min-h-24 resize-y py-2.5", className)} {...props} />;
}

interface FieldProps {
	label: ReactNode;
	hint?: ReactNode;
	error?: ReactNode;
	optional?: ReactNode;
	className?: string;
	/** Render prop receives the generated id and describedby for the control. */
	children(props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }): ReactNode;
}

export function Field({ label, hint, error, optional, className, children }: FieldProps) {
	const id = useId();
	const hintId = `${id}-hint`;
	const describedBy = error || hint ? hintId : undefined;
	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			<label htmlFor={id} className="flex items-baseline justify-between gap-2 font-medium text-ink text-small">
				<span>{label}</span>
				{optional ? <span className="font-normal text-ink-subtle text-tiny">{optional}</span> : null}
			</label>
			{children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
			{error ? (
				<p id={hintId} role="alert" className="text-danger text-small">
					{error}
				</p>
			) : hint ? (
				<p id={hintId} className="text-ink-subtle text-small">
					{hint}
				</p>
			) : null}
		</div>
	);
}
