import { useColorScheme } from "@/lib/theme";
import { useIsMobile } from "@/lib/use-media-query";
import { Toaster } from "sonner";

/** Bottom-center on mobile (above the tab bar), bottom-right on desktop. */
export function AppToaster() {
	const scheme = useColorScheme();
	const mobile = useIsMobile();
	return (
		<Toaster
			theme={scheme}
			position={mobile ? "bottom-center" : "bottom-right"}
			offset={mobile ? { bottom: 88 } : 24}
			mobileOffset={{ bottom: 88, left: 16, right: 16 }}
			duration={5000}
			gap={8}
			toastOptions={{
				classNames: {
					toast:
						"!rounded-lg !border !border-line !bg-surface !text-ink !shadow-pop !font-sans !text-small !gap-3 !py-3 !px-4",
					title: "!font-medium",
					description: "!text-ink-muted",
					actionButton:
						"!bg-accent-soft !text-ink dark:!text-accent !font-semibold !rounded-full !h-7 !px-3",
				},
			}}
		/>
	);
}
