import * as MenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Menu = MenuPrimitive.Root;
export const MenuTrigger = MenuPrimitive.Trigger;

export function MenuContent({
	className,
	align = "end",
	sideOffset = 6,
	...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
	return (
		<MenuPrimitive.Portal>
			<MenuPrimitive.Content
				align={align}
				sideOffset={sideOffset}
				collisionPadding={8}
				className={cn(
					"z-50 min-w-52 overflow-hidden rounded-lg border border-line bg-surface p-1.5 shadow-pop data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in",
					className,
				)}
				{...props}
			/>
		</MenuPrimitive.Portal>
	);
}

interface MenuItemProps extends ComponentProps<typeof MenuPrimitive.Item> {
	icon?: ReactNode;
	destructive?: boolean;
	shortcut?: ReactNode;
}

export function MenuItem({ className, icon, destructive, shortcut, children, ...props }: MenuItemProps) {
	return (
		<MenuPrimitive.Item
			className={cn(
				"flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-sm px-2.5 text-ink text-small outline-none transition-colors data-[disabled]:pointer-events-none data-[highlighted]:bg-hover data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-ink-subtle",
				destructive && "text-danger data-[highlighted]:bg-danger-soft [&_svg]:text-danger",
				className,
			)}
			{...props}
		>
			{icon}
			<span className="flex-1 truncate">{children}</span>
			{shortcut ? <span className="text-ink-subtle text-tiny">{shortcut}</span> : null}
		</MenuPrimitive.Item>
	);
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof MenuPrimitive.Separator>) {
	return <MenuPrimitive.Separator className={cn("-mx-1.5 my-1.5 h-px bg-line", className)} {...props} />;
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
	return <MenuPrimitive.Label className={cn("section-label px-2.5 pt-1.5 pb-1", className)} {...props} />;
}
