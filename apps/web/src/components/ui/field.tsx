import { cn } from "@/lib/utils";
import { type ComponentProps, type ReactNode, useId } from "react";
import { controlClass } from "./control";

export { Textarea } from "./textarea";

export function Input({ className, ...props }: ComponentProps<"input">) {
	return <input className={cn(controlClass, "h-11", className)} {...props} />;
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
			<label
				htmlFor={id}
				className="flex items-baseline justify-between gap-2 font-medium text-ink text-small"
			>
				<span>{label}</span>
				{optional ? (
					<span className="font-normal text-ink-subtle text-tiny">{optional}</span>
				) : null}
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
