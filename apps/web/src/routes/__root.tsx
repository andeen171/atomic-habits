import { CommandPalette } from "@/components/dialogs/command-palette";
import { FourLawsDialog } from "@/components/dialogs/four-laws-dialog";
import { NoteDialog } from "@/components/dialogs/note-dialog";
import { ShortcutsDialog } from "@/components/dialogs/shortcuts-dialog";
import { AppToaster } from "@/components/layout/app-toaster";
import { ErrorScreen, NotFoundScreen } from "@/components/layout/fallback-screens";
import { Splash } from "@/components/layout/splash";
import { TaskDialog } from "@/components/tasks/task-dialog";
import { EntryComposerDialog } from "@/components/trackers/entry-composer";
import { useArtifactCloudStatus } from "@/lib/artifact-cloud";
import { focusPage, noteNavigation } from "@/lib/focus";
import { type AppI18n, useT } from "@/lib/messages";
import { useMonthCelebration } from "@/lib/use-month-celebration";
import { useGlobalShortcuts } from "@/lib/use-shortcuts";
import { useStoreNotices } from "@/lib/use-store-notices";
import { useAtomic, useHydrated, useLocale } from "@atomic/core/react";
import { Navigate, Outlet, createRootRoute, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

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
	const cloud = useArtifactCloudStatus();
	useGlobalShortcuts();
	useStoreNotices();
	// Here, not in the shell: the timer and writing pad save entries outside it.
	useMonthCelebration();

	useEffect(() => {
		document.documentElement.lang = locale;
	}, [locale]);

	useRouteAnnouncer(pathname);

	// The artifact build also waits (briefly) for the viewer's cloud copy.
	if (!hydrated || cloud === "connecting") return <Splash />;
	if (!onboarded && pathname !== "/onboarding") return <Navigate to="/onboarding" replace />;

	return (
		<>
			<Outlet />
			<TaskDialog />
			<NoteDialog />
			<EntryComposerDialog />
			<ShortcutsDialog />
			<FourLawsDialog />
			<CommandPalette />
			<AppToaster />
		</>
	);
}

const HABIT_ROUTE = /^\/habits\/([^/]+)(\/edit|\/timer|\/write)?$/;
const SCREENS = [
	"tasks",
	"identity",
	"journal",
	"insights",
	"scorecard",
	"settings",
	"you",
	"account",
] as const;

function screenTitle(pathname: string, t: AppI18n["t"], habitName: string | undefined) {
	if (pathname === "/") return t("nav.today");
	if (pathname === "/habits") return t("nav.habits");
	if (pathname === "/habits/new") return t("form.newTitle");
	if (pathname === "/journal/new") return t("create.journalEntry");
	if (pathname.startsWith("/journal/")) return t("nav.journal");
	const habit = HABIT_ROUTE.exec(pathname);
	if (habit) return habit[2] === "/edit" ? t("form.editTitle") : (habitName ?? t("nav.habits"));
	const screen = SCREENS.find((key) => pathname === `/${key}`);
	return screen ? t(`nav.${screen}`) : null;
}

/**
 * Route changes are otherwise silent for assistive tech: keep document.title
 * in step with the screen and, when the focused control went away with the
 * old page, move focus to the new page's heading.
 */
function useRouteAnnouncer(pathname: string) {
	const { t, at } = useT();
	const habitId = HABIT_ROUTE.exec(pathname)?.[1];
	const habitName = useAtomic((s) => (habitId ? s.data.habits[habitId]?.name : undefined));
	const page = screenTitle(pathname, t, habitName);
	const app = t("app.name");
	const title = page ? at("page.title", { page, app }) : app;
	const previous = useRef(pathname);

	useEffect(() => {
		document.title = title;
	}, [title]);

	useEffect(() => {
		if (previous.current === pathname) return;
		previous.current = pathname;
		noteNavigation();
		// Wait a frame so the new screen (and any autofocused field) is in place.
		const frame = requestAnimationFrame(() => focusPage({ announceOtherwise: true }));
		return () => cancelAnimationFrame(frame);
	}, [pathname]);
}
