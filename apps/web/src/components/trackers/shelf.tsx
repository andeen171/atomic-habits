import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import type { Habit, ShelfBook, SummaryBlock } from "@atomic/core";
import { BookOpen, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ProgressBar } from "../ui/progress-bar";
import { BookDialog } from "./book-dialog";

type ShelfBlock = Extract<SummaryBlock, { kind: "shelf" }>;

/**
 * The reading shelf (Annex K §1.8.2): reading now with page progress and the
 * finish projection, up next, and the books finished this year. A book
 * opens its dialog (edit, change status, delete). Owner: T4.
 */
export function Shelf({
	habit,
	block,
	editable,
}: {
	habit: Habit;
	block: ShelfBlock | null;
	editable: boolean;
}) {
	const { t } = useT();
	const [book, setBook] = useState<string | "new" | null>(null);
	const open = (id: string) => editable && setBook(id);
	const empty = !block || block.reading.length + block.next.length + block.finished.length === 0;

	return (
		<section className="flex min-w-0 flex-col gap-3">
			<div className="flex items-center justify-between gap-3">
				<h3 className="section-label">{t("tracker.reading.shelf")}</h3>
				{editable ? (
					<button
						type="button"
						onClick={() => setBook("new")}
						className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 font-medium text-accent-text text-small hover:bg-accent-soft"
					>
						<Plus aria-hidden="true" className="size-4" />
						{t("tracker.reading.addBook")}
					</button>
				) : null}
			</div>
			{empty ? (
				<p className="flex items-start gap-2.5 rounded-lg bg-sunken/60 px-3.5 py-3 text-ink-muted text-small">
					<BookOpen aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
					{t("tracker.reading.noBooks")}
				</p>
			) : (
				<>
					{block.reading.length ? (
						<div className="flex flex-col gap-2">
							<h4 className="font-medium text-ink-muted text-small">
								{t("tracker.reading.readingNow")}
							</h4>
							<ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
								{block.reading.map((item) => (
									<li key={item.id}>
										<ReadingCard book={item} onOpen={() => open(item.id)} editable={editable} />
									</li>
								))}
							</ul>
						</div>
					) : null}
					{block.next.length ? (
						<div className="flex flex-col gap-2">
							<h4 className="font-medium text-ink-muted text-small">
								{t("tracker.reading.upNext")}
							</h4>
							<ul className="flex flex-wrap gap-1.5">
								{block.next.map((item) => (
									<li key={item.id}>
										<BookChip book={item} onOpen={() => open(item.id)} editable={editable} />
									</li>
								))}
							</ul>
						</div>
					) : null}
					{block.finished.length ? (
						<div className="flex flex-col gap-2">
							<h4 className="font-medium text-ink-muted text-small">
								{t("tracker.reading.finished")} ·{" "}
								{t.tp("tracker.reading.booksFinished", block.finished.length)}
							</h4>
							<ul className="-mx-2 flex flex-col">
								{block.finished.map((item) => (
									<li key={item.id}>
										<FinishedRow book={item} onOpen={() => open(item.id)} editable={editable} />
									</li>
								))}
							</ul>
						</div>
					) : null}
				</>
			)}
			{editable ? (
				<BookDialog
					habit={habit}
					open={book !== null}
					onOpenChange={(next) => !next && setBook(null)}
					bookId={book === "new" ? null : book}
				/>
			) : null}
		</section>
	);
}

function Wrapper({
	editable,
	onOpen,
	className,
	children,
}: {
	editable: boolean;
	onOpen(): void;
	className: string;
	children: ReactNode;
}) {
	return editable ? (
		<button type="button" onClick={onOpen} className={cn("text-left", className)}>
			{children}
		</button>
	) : (
		<div className={className}>{children}</div>
	);
}

function ReadingCard({
	book,
	onOpen,
	editable,
}: {
	book: ShelfBook;
	onOpen(): void;
	editable: boolean;
}) {
	const { t } = useT();
	return (
		<Wrapper
			editable={editable}
			onOpen={onOpen}
			className="flex w-full flex-col gap-2 rounded-lg border border-line bg-surface p-3.5 transition-colors hover:border-line-strong"
		>
			<span className="flex items-start gap-2.5">
				<span
					aria-hidden="true"
					className="grid h-10 w-8 shrink-0 place-items-center rounded-sm bg-(--habit-soft) font-emoji text-sm"
				>
					📖
				</span>
				<span className="min-w-0 flex-1">
					<span className="line-clamp-2 block break-words font-medium text-ink text-small">
						{book.title}
					</span>
					<span className="block truncate text-ink-subtle text-tiny">
						{[book.author, book.status === "paused" ? t("tracker.bookStatus.paused") : null]
							.filter(Boolean)
							.join(" · ")}
					</span>
				</span>
			</span>
			{book.progress !== null ? (
				<ProgressBar
					value={book.page}
					max={book.pages ?? book.page}
					label={book.title}
					valueText={book.progressLabel ?? undefined}
					tone="habit"
					size="sm"
				/>
			) : null}
			{book.progressLabel || book.projection ? (
				<span className="flex flex-col text-tiny">
					{book.progressLabel ? (
						<span className="font-medium text-ink tabular-nums">{book.progressLabel}</span>
					) : null}
					{book.projection ? <span className="text-ink-muted">{book.projection}</span> : null}
				</span>
			) : null}
		</Wrapper>
	);
}

function BookChip({
	book,
	onOpen,
	editable,
}: { book: ShelfBook; onOpen(): void; editable: boolean }) {
	return (
		<Wrapper
			editable={editable}
			onOpen={onOpen}
			className="inline-flex h-8 max-w-64 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-ink text-small hover:border-line-strong"
		>
			<span className="truncate">{book.title}</span>
		</Wrapper>
	);
}

function FinishedRow({
	book,
	onOpen,
	editable,
}: {
	book: ShelfBook;
	onOpen(): void;
	editable: boolean;
}) {
	const { t } = useT();
	const rating = book.rating ? t(`tracker.rating.${book.rating as 1 | 2 | 3 | 4 | 5}`) : null;
	return (
		<Wrapper
			editable={editable}
			onOpen={onOpen}
			className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 hover:bg-hover"
		>
			<span className="min-w-0 flex-1">
				<span className="block break-words text-ink text-small">{book.title}</span>
				<span className="block text-ink-subtle text-tiny">
					{[
						book.author,
						book.finishedOn
							? t("tracker.reading.finishedOn", { date: t.formatDayShort(book.finishedOn) })
							: null,
					]
						.filter(Boolean)
						.join(" · ")}
				</span>
			</span>
			{rating ? (
				<span className="shrink-0 text-ink-muted text-tiny">
					<span aria-hidden="true">{"★".repeat(book.rating ?? 0)} </span>
					{rating}
				</span>
			) : null}
		</Wrapper>
	);
}
