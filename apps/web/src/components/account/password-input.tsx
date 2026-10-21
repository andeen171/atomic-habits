import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { Input } from "../ui/field";

/**
 * A password field with a show/hide toggle (Annex C §4): the toggle is a
 * pressed-state button named "Show password", so its name never flips.
 * Owner: T5.
 */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
	const { t } = useT();
	const [visible, setVisible] = useState(false);
	return (
		<div className="relative">
			<Input
				{...props}
				type={visible ? "text" : "password"}
				autoCapitalize="off"
				autoCorrect="off"
				spellCheck={false}
				className={cn("pr-12", className)}
			/>
			<button
				type="button"
				aria-label={t("account.showPassword")}
				aria-pressed={visible}
				aria-controls={props.id}
				disabled={props.disabled}
				onClick={() => setVisible((v) => !v)}
				className="-translate-y-1/2 absolute top-1/2 right-1 inline-flex size-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-50"
			>
				{visible ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
			</button>
		</div>
	);
}
