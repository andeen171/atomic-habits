import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { useT } from "@/lib/messages";
import {
	type DayKey,
	type JournalKind,
	type ReviewScope,
	isDayKey,
	isJournalKind,
	toDayKey,
} from "@atomic/core";
import {
	Link,
	createFileRoute,
	useCanGoBack,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { X } from "lucide-react";

/** Prefills of a new entry (Annex J §1.4, §4). Without `kind`, the kind picker shows. */
export interface NewJournalSearch {
	kind?: JournalKind;
	identity?: string;
	habit?: string;
	/** The day the entry is about (never after today). */
	date?: DayKey;
	/** A review's period. */
	scope?: ReviewScope;
}

const SCOPES: readonly ReviewScope[] = ["week", "month", "year"];

const id = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : undefined;

export const Route = createFileRoute("/journal/new")({
	validateSearch: (search: Record<string, unknown>): NewJournalSearch => {
		const out: NewJournalSearch = {};
		if (isJournalKind(search.kind)) out.kind = search.kind;
		const identity = id(search.identity);
		const habit = id(search.habit);
		if (identity) out.identity = identity;
		if (habit) out.habit = habit;
		if (isDayKey(search.date) && search.date <= toDayKey()) out.date = search.date;
		if (SCOPES.includes(search.scope as ReviewScope)) out.scope = search.scope as ReviewScope;
		return out;
	},
	component: NewJournalEntryScreen,
});

/**
 * New journal entry, outside the shell like the habit editor (Annex J §4):
 * the kind picker, the habit step when the kind needs one, then the editor
 * keyed by the search. Owner: T3. Phase 1B: a placeholder.
 */
function NewJournalEntryScreen() {
	const { t } = useT();
	const router = useRouter();
	const canGoBack = useCanGoBack();
	const navigate = useNavigate();
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
					<h1 className="min-w-0 flex-1 truncate font-semibold text-ink">
						{t("create.journalEntry")}
					</h1>
				</div>
			</header>
			<main
				id="main"
				tabIndex={-1}
				className="mx-auto w-full max-w-[680px] flex-1 px-5 py-10 outline-none"
			>
				<EmptyState
					title={t("app.comingSoon")}
					body={t("app.comingSoonBody")}
					action={
						<Button asChild variant="secondary">
							<Link to="/journal">{t("nav.journal")}</Link>
						</Button>
					}
				/>
			</main>
		</div>
	);
}
