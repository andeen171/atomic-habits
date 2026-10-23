import { BookOpen, Plus } from "@/components/icons";
import { PressableScale } from "@/components/ui/pressable-scale";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import { type Habit, type ShelfBook, type SummaryBlock, attachmentRefSchema } from "@atomic/core";
import { useTrackerEntry } from "@atomic/core/react";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { BookSheet } from "./book-sheet";
import { trackerCaps } from "./caps";
import { PhotoThumb } from "./photo-thumb";

type ShelfBlock = Extract<SummaryBlock, { kind: "shelf" }>;

/**
 * The reading shelf (Annex K §1.8.2): reading now with page progress and the
 * finish projection, up next, and the books finished this year. A book opens
 * its sheet (edit, change status, delete). Owner: T4.
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
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const [book, setBook] = useState<string | "new" | null>(null);
	const [sheetBook, setSheetBook] = useState<string | null>(null);
	const open = (id: string | "new") => {
		if (!editable) return;
		haptics.selection();
		setSheetBook(id === "new" ? null : id);
		setBook(id);
	};
	const empty = !block || block.reading.length + block.next.length + block.finished.length === 0;

	return (
		<View style={styles.section}>
			<View style={styles.header}>
				<Text variant="label" accessibilityRole="header">
					{t.t("tracker.reading.shelf")}
				</Text>
				{editable ? (
					<PressableScale
						onPress={() => open("new")}
						accessibilityRole="button"
						accessibilityLabel={t.t("tracker.reading.addBook")}
						hitSlop={8}
						style={styles.add}
						testID="shelf-add-book"
					>
						<Plus size={15} color={colors.accentText} strokeWidth={2.4} />
						<Text variant="small" weight="semibold" tone="accent">
							{t.t("tracker.reading.addBook")}
						</Text>
					</PressableScale>
				) : null}
			</View>
			{empty ? (
				<View style={styles.empty}>
					<BookOpen size={16} color={colors.textSubtle} style={{ marginTop: 2 }} />
					<Text variant="small" tone="muted" style={styles.grow}>
						{t.t("tracker.reading.noBooks")}
					</Text>
				</View>
			) : (
				<>
					{block.reading.length ? (
						<View style={styles.group}>
							<Text variant="small" weight="medium" tone="muted">
								{t.t("tracker.reading.readingNow")}
							</Text>
							{block.reading.map((item) => (
								<ReadingCard
									key={item.id}
									book={item}
									habit={habit}
									editable={editable}
									onOpen={() => open(item.id)}
								/>
							))}
						</View>
					) : null}
					{block.next.length ? (
						<View style={styles.group}>
							<Text variant="small" weight="medium" tone="muted">
								{t.t("tracker.reading.upNext")}
							</Text>
							<View style={styles.wrap}>
								{block.next.map((item) => (
									<Wrapper
										key={item.id}
										editable={editable}
										label={item.title}
										onOpen={() => open(item.id)}
										style={styles.chip}
									>
										<Text variant="small" numberOfLines={1}>
											{item.title}
										</Text>
									</Wrapper>
								))}
							</View>
						</View>
					) : null}
					{block.finished.length ? (
						<View style={styles.group}>
							<Text variant="small" weight="medium" tone="muted">
								{t.t("tracker.reading.finishedThisYear", {
									count: t.number(block.finished.length),
								})}
							</Text>
							<View style={styles.list}>
								{block.finished.map((item) => (
									<FinishedRow
										key={item.id}
										book={item}
										editable={editable}
										onOpen={() => open(item.id)}
									/>
								))}
							</View>
						</View>
					) : null}
				</>
			)}
			{editable ? (
				<BookSheet
					habit={habit}
					open={book !== null}
					onClose={() => setBook(null)}
					bookId={sheetBook}
				/>
			) : null}
		</View>
	);
}

function Wrapper({
	editable,
	onOpen,
	label,
	style,
	children,
}: {
	editable: boolean;
	onOpen(): void;
	label: string;
	style: object;
	children: ReactNode;
}) {
	return editable ? (
		<PressableScale
			onPress={onOpen}
			scaleTo={0.98}
			accessibilityRole="button"
			accessibilityLabel={label}
			style={style}
		>
			{children}
		</PressableScale>
	) : (
		<View style={style} accessible accessibilityLabel={label}>
			{children}
		</View>
	);
}

function ReadingCard({
	book,
	habit,
	onOpen,
	editable,
}: {
	book: ShelfBook;
	habit: Habit;
	onOpen(): void;
	editable: boolean;
}) {
	const t = useT();
	const { habit: toneOf } = useTheme();
	const styles = useStyles();
	const tone = toneOf(habit.color);
	const meta = [book.author, book.status === "paused" ? t.t("tracker.bookStatus.paused") : null]
		.filter(Boolean)
		.join(" · ");
	const label = [book.title, meta, book.progressLabel, book.projection].filter(Boolean).join(". ");
	return (
		<Wrapper editable={editable} onOpen={onOpen} label={label} style={styles.card}>
			<View style={styles.cardTop}>
				<BookCover id={book.id} soft={tone.soft} />
				<View style={styles.grow}>
					<Text variant="small" weight="semibold" numberOfLines={2}>
						{book.title}
					</Text>
					{meta ? (
						<Text variant="tiny" tone="muted" numberOfLines={1}>
							{meta}
						</Text>
					) : null}
				</View>
			</View>
			{book.progress !== null ? (
				<ProgressBar
					value={book.page}
					max={book.pages ?? book.page}
					color={tone.fill}
					height={6}
					accessibilityLabel={book.title}
					valueText={book.progressLabel ?? undefined}
				/>
			) : null}
			{book.progressLabel || book.projection ? (
				<View>
					{book.progressLabel ? (
						<Text variant="tiny" weight="semibold" tabular>
							{book.progressLabel}
						</Text>
					) : null}
					{book.projection ? (
						<Text variant="tiny" tone="muted">
							{book.projection}
						</Text>
					) : null}
				</View>
			) : null}
		</Wrapper>
	);
}

/** The book's cover photo, or 📖 when it has none (or photos are off). */
function BookCover({ id, soft }: { id: string; soft: string }) {
	const styles = useStyles();
	const entry = useTrackerEntry(id);
	const parsed = attachmentRefSchema.safeParse(entry?.data.cover);
	if (parsed.success && trackerCaps().photos) {
		return (
			<View style={styles.coverPhoto}>
				<PhotoThumb photo={parsed.data} alt="" ratio={34 / 44} radius={6} decorative />
			</View>
		);
	}
	return (
		<View style={[styles.cover, { backgroundColor: soft }]}>
			<Text style={styles.coverEmoji} allowFontScaling={false}>
				📖
			</Text>
		</View>
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
	const t = useT();
	const styles = useStyles();
	const rating = book.rating ? t.t(`tracker.rating.${book.rating as 1 | 2 | 3 | 4 | 5}`) : null;
	const meta = [
		book.author,
		book.finishedOn
			? t.t("tracker.reading.finishedOn", { date: t.formatDayShort(book.finishedOn) })
			: null,
	]
		.filter(Boolean)
		.join(" · ");
	return (
		<Wrapper
			editable={editable}
			onOpen={onOpen}
			label={[book.title, meta, rating].filter(Boolean).join(". ")}
			style={styles.row}
		>
			<View style={styles.grow}>
				<Text variant="small">{book.title}</Text>
				{meta ? (
					<Text variant="tiny" tone="subtle">
						{meta}
					</Text>
				) : null}
			</View>
			{rating ? (
				<View style={styles.rating}>
					<Text variant="tiny" tone="accent" allowFontScaling={false}>
						{"★".repeat(book.rating ?? 0)}
					</Text>
					<Text variant="tiny" tone="muted">
						{rating}
					</Text>
				</View>
			) : null}
		</Wrapper>
	);
}

const useStyles = makeStyles((t) => ({
	section: { gap: 12 },
	header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
	add: {
		flexDirection: "row",
		alignItems: "center",
		gap: 4,
		minHeight: 32,
		paddingHorizontal: 10,
		borderRadius: 999,
		backgroundColor: t.colors.accentSoft,
	},
	empty: {
		flexDirection: "row",
		gap: 10,
		paddingHorizontal: 14,
		paddingVertical: 12,
		borderRadius: t.radii.md,
		backgroundColor: t.colors.sunken,
	},
	grow: { flex: 1 },
	group: { gap: 8 },
	wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
	chip: {
		height: 34,
		maxWidth: "100%",
		justifyContent: "center",
		paddingHorizontal: 12,
		borderRadius: 999,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
	card: {
		gap: 10,
		padding: 14,
		borderRadius: t.radii.lg,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
	},
	cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
	cover: {
		width: 34,
		height: 44,
		borderRadius: 6,
		alignItems: "center",
		justifyContent: "center",
	},
	coverEmoji: { fontSize: 16, lineHeight: 20 },
	coverPhoto: { width: 34 },
	list: { marginHorizontal: -8 },
	row: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 10,
		minHeight: 44,
		paddingHorizontal: 8,
		paddingVertical: 8,
		borderRadius: t.radii.md,
	},
	rating: { alignItems: "flex-end", gap: 1 },
}));
