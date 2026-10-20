import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { useT } from "@/lib/messages";
import { useAtomic } from "@atomic/core/react";
import {
	Link,
	createFileRoute,
	useCanGoBack,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { X } from "lucide-react";

export const Route = createFileRoute("/journal/$entryId")({
	component: JournalEntryScreen,
});

/**
 * One journal entry in the editor, outside the shell (Annex J §4), or "not
 * found" when it is missing or deleted. Owner: T3. Phase 1B: a placeholder.
 */
function JournalEntryScreen() {
	const { entryId } = Route.useParams();
	const { t } = useT();
	const router = useRouter();
	const canGoBack = useCanGoBack();
	const navigate = useNavigate();
	const exists = useAtomic((s) => {
		const entry = s.data.journal[entryId];
		return !!entry && !entry.deletedAt;
	});
	const close = () => {
		if (canGoBack) router.history.back();
		else void navigate({ to: "/journal" });
	};
	return (
		<div className="flex min-h-dvh flex-col">
			<header className="sticky top-0 z-20 border-line border-b bg-bg/85 backdrop-blur-xl">
				<div className="mx-auto flex min-h-16 w-full max-w-[680px] items-center gap-3 px-4 py-2 md:px-8">
					<IconButton label={t("common.close")} onClick={close}>
						<X />
					</IconButton>
					<h1 className="min-w-0 flex-1 truncate font-semibold text-ink">{t("nav.journal")}</h1>
				</div>
			</header>
			<main
				id="main"
				tabIndex={-1}
				className="mx-auto w-full max-w-[680px] flex-1 px-5 py-10 outline-none"
			>
				{exists ? (
					<EmptyState title={t("app.comingSoon")} body={t("app.comingSoonBody")} />
				) : (
					<EmptyState
						title={t("notFound.title")}
						body={t("notFound.body")}
						action={
							<Button asChild>
								<Link to="/journal">{t("nav.journal")}</Link>
							</Button>
						}
					/>
				)}
			</main>
		</div>
	);
}
