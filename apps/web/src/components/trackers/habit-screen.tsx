import { useT } from "@/lib/messages";
import type { Habit } from "@atomic/core";
import { useText } from "@atomic/core/react";
import { Link, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { X } from "lucide-react";
import { type ReactNode, useCallback } from "react";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { IconButton } from "../ui/icon-button";

/** Back to where the user came from, else the habit page. */
export function useCloseScreen(habitId: string): () => void {
	const router = useRouter();
	const canGoBack = useCanGoBack();
	const navigate = useNavigate();
	return useCallback(() => {
		if (canGoBack) router.history.back();
		else void navigate({ to: "/habits/$habitId", params: { habitId } });
	}, [canGoBack, router, navigate, habitId]);
}

/**
 * The full-screen tracker routes (timer, writing pad; Annex K §4.2): a close
 * button back to where the user came from, the habit's name, an optional
 * status on the right, then the screen. Owner: T4.
 */
export function HabitScreen({
	habit,
	habitId,
	aside,
	children,
	width = "max-w-[680px]",
}: {
	habit: Habit | undefined;
	habitId: string;
	aside?: ReactNode;
	children: ReactNode;
	width?: string;
}) {
	const { t } = useT();
	const text = useText();
	const close = useCloseScreen(habitId);
	return (
		<div className="flex min-h-dvh flex-col">
			<header className="sticky top-0 z-20 border-line border-b bg-bg/85 backdrop-blur-xl">
				<div
					className={`mx-auto flex min-h-16 w-full ${width} items-center gap-3 px-4 py-2 md:px-8`}
				>
					<IconButton label={t("common.close")} onClick={close}>
						<X />
					</IconButton>
					<h1 className="flex min-w-0 flex-1 items-center gap-2 font-semibold text-ink">
						{habit ? (
							<>
								<span aria-hidden="true" className="font-emoji">
									{habit.emoji}
								</span>
								<span className="truncate">{text.habit(habit, "name")}</span>
							</>
						) : (
							t("notFound.title")
						)}
					</h1>
					{aside}
				</div>
			</header>
			<main
				id="main"
				tabIndex={-1}
				className={`mx-auto flex w-full ${width} flex-1 flex-col px-5 outline-none md:px-8`}
			>
				{children}
			</main>
		</div>
	);
}

/** A habit that's gone or can't use this screen. */
export function ScreenNotice({
	title,
	body,
	habitId,
}: { title: string; body: string; habitId?: string }) {
	const { t } = useT();
	return (
		<EmptyState
			title={title}
			body={body}
			action={
				<Button asChild>
					{habitId ? (
						<Link to="/habits/$habitId" params={{ habitId }}>
							{t("habit.viewDetails")}
						</Link>
					) : (
						<Link to="/habits">{t("nav.habits")}</Link>
					)}
				</Button>
			}
		/>
	);
}
