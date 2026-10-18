import { AppShell } from "@/components/layout/app-shell";
import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app")({
	component: () => (
		<AppShell>
			<Outlet />
		</AppShell>
	),
});
