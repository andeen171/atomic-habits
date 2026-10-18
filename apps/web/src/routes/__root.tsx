import { CommandPalette } from "@/components/dialogs/command-palette";
import { FourLawsDialog } from "@/components/dialogs/four-laws-dialog";
import { NoteDialog } from "@/components/dialogs/note-dialog";
import { ShortcutsDialog } from "@/components/dialogs/shortcuts-dialog";
import { AppToaster } from "@/components/layout/app-toaster";
import { ErrorScreen, NotFoundScreen } from "@/components/layout/fallback-screens";
import { Splash } from "@/components/layout/splash";
import { TaskDialog } from "@/components/tasks/task-dialog";
import { useGlobalShortcuts } from "@/lib/use-shortcuts";
import { useAtomic, useHydrated, useLocale } from "@atomic/core/react";
import { Navigate, Outlet, createRootRoute, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createRootRoute({
	component: RootLayout,
	notFoundComponent: NotFoundScreen,
	errorComponent: ErrorScreen,
});

function RootLayout() {
	const hydrated = useHydrated();
	const onboarded = useAtomic((s) => s.settings.onboarded);
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const locale = useLocale();
	useGlobalShortcuts();

	useEffect(() => {
		document.documentElement.lang = locale;
	}, [locale]);

	if (!hydrated) return <Splash />;
	if (!onboarded && pathname !== "/onboarding") return <Navigate to="/onboarding" replace />;

	return (
		<>
			<Outlet />
			<TaskDialog />
			<NoteDialog />
			<ShortcutsDialog />
			<FourLawsDialog />
			<CommandPalette />
			<AppToaster />
		</>
	);
}
