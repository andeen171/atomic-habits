import { useT } from "@/lib/messages";
import { useHabit } from "@atomic/core/react";
import { Link, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { IconButton } from "../ui/icon-button";

/**
 * Phase 1B shell of the full-screen tracker routes (timer, writing pad):
 * a close button back to where the user came from and the habit's name.
 * Owner: T4, who replaces it with the real screens.
 */
export function HabitScreenPlaceholder({ habitId }: { habitId: string }) {
	const { t } = useT();
	const habit = useHabit(habitId);
	const router = useRouter();
	const canGoBack = useCanGoBack();
	const navigate = useNavigate();
	const close = () => {
		if (canGoBack) router.history.back();
		else void navigate({ to: "/habits/$habitId", params: { habitId } });
	};
	return (
		<div className="flex min-h-dvh flex-col">
			<header className="sticky top-0 z-20 border-line border-b bg-bg/85 backdrop-blur-xl">
				<div className="mx-auto flex min-h-16 w-full max-w-[680px] items-center gap-3 px-4 py-2 md:px-8">
					<IconButton label={t("common.close")} onClick={close}>
						<X />
					</IconButton>
					<h1 className="min-w-0 flex-1 truncate font-semibold text-ink">
						{habit ? (
							<>
								<span className="font-emoji">{habit.emoji}</span> {habit.name}
							</>
						) : (
							t("notFound.title")
						)}
					</h1>
				</div>
			</header>
			<main
				id="main"
				tabIndex={-1}
				className="mx-auto w-full max-w-[680px] flex-1 px-5 py-10 outline-none"
			>
				{habit ? (
					<EmptyState title={t("app.comingSoon")} body={t("app.comingSoonBody")} />
				) : (
					<EmptyState
						title={t("notFound.title")}
						body={t("notFound.body")}
						action={
							<Button asChild>
								<Link to="/habits">{t("nav.habits")}</Link>
							</Button>
						}
					/>
				)}
			</main>
		</div>
	);
}
