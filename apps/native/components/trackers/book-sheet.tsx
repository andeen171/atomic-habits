import { ImagePlus, Trash2, X } from "@/components/icons";
import { ConfirmSheet } from "@/components/sheet/confirm-sheet";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Text } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { savePhoto } from "@/lib/image";
import { makeStyles, useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import {
	type AttachmentRef,
	type FieldSpec,
	type FormValue,
	type FormValues,
	type Habit,
	attachmentRefSchema,
	formToData,
} from "@atomic/core";
import { useActions, useEntryForm, useText, useToday, useTrackerEntry } from "@atomic/core/react";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { trackerCaps } from "./caps";
import { FieldRenderer } from "./fields";
import { PhotoSourceSheet, photoFailed, pickWithFeedback } from "./photo-field";
import { PhotoThumb } from "./photo-thumb";

export interface BookSheetProps {
	habit: Habit;
	open: boolean;
	onClose(): void;
	/** Edit this book; a new one otherwise. */
	bookId?: string | null;
	/** Called with the saved book's id (the composer selects a new book). */
	onSaved?(id: string): void;
}

/**
 * A book on the reading shelf (Annex K §1.8.2, §5.1 `book-sheet.tsx`):
 * title, author, pages, status, starting page and rating, and a cover photo
 * where photos work; edit, change status or delete (the sessions stay and
 * read "Deleted book"). Owner: T4.
 */
export function BookSheet({ habit, open, onClose, bookId, onSaved }: BookSheetProps) {
	const t = useT();
	const text = useText();
	const actions = useActions();
	const today = useToday();
	const styles = useStyles();
	const book = useTrackerEntry(bookId ?? undefined);
	const editing = !!book && !book.deletedAt;
	const { specs, initial } = useEntryForm(
		habit,
		"book",
		today,
		editing ? bookId : null,
		trackerCaps(),
	);
	const [values, setValues] = useState<FormValues>(initial);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [confirmDelete, setConfirmDelete] = useState(false);
	const photos = trackerCaps().photos;
	const storedCover = () => {
		const parsed = attachmentRefSchema.safeParse(editing ? book.data.cover : null);
		return parsed.success ? parsed.data : null;
	};
	const [cover, setCover] = useState<AttachmentRef | null>(storedCover);
	const [coverBusy, setCoverBusy] = useState(false);

	// Each opening starts from the book as stored (or a blank one).
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on open only.
	useEffect(() => {
		if (!open) return;
		setValues(initial);
		setErrors({});
		setCover(storedCover());
	}, [open, bookId]);

	const setValue = (spec: FieldSpec, value: FormValue) => {
		setValues((current) => ({ ...current, [spec.key]: value }));
		if (errors[spec.key]) setErrors(({ [spec.key]: _, ...rest }) => rest);
	};

	const save = () => {
		if (coverBusy) return;
		const result = formToData(specs, values, t);
		if (!result.ok) {
			haptics.warning();
			setErrors(result.errors);
			return;
		}
		const data: Record<string, unknown> = { ...result.data };
		if (photos) data.cover = cover;
		const wasFinished = book?.data.status === "finished";
		if (data.status === "finished" && !wasFinished) data.finishedOn = today;
		if (data.status !== "finished") data.finishedOn = null;
		const saved = editing
			? actions.updateTrackerEntry(book.id, { data })
			: actions.addTrackerEntry({ habitId: habit.id, date: today, type: "book", at: null, data });
		if (!saved) {
			haptics.warning();
			showToast(t.t("tracker.saveFailed"), { tone: "danger" });
			return;
		}
		haptics.light();
		showToast(`${t.t("tracker.reading.bookSaved")} · ${String(data.title ?? "")}`, {
			tone: "success",
		});
		onSaved?.(saved.id);
		onClose();
	};

	const remove = () => {
		if (!book) return;
		actions.deleteTrackerEntry(book.id);
		haptics.medium();
		showToast(t.t("tracker.reading.bookDeleted"), {
			action: { label: t.t("common.undo"), onPress: () => actions.restoreTrackerEntry(book.id) },
		});
		onClose();
	};

	return (
		<>
			<Sheet
				open={open}
				onClose={onClose}
				title={editing ? t.t("tracker.reading.editBook") : t.t("tracker.reading.newBook")}
				subtitle={text.habit(habit, "name")}
				scroll
				closeButton
				testID="book-sheet"
				footer={
					<View style={styles.footer}>
						{editing ? (
							<IconButton
								icon={Trash2}
								variant="soft"
								size={46}
								color={styles.danger.color}
								accessibilityLabel={t.t("tracker.reading.deleteBook")}
								onPress={() => setConfirmDelete(true)}
							/>
						) : null}
						<Button
							label={coverBusy ? t.t("tracker.photo.preparing") : t.t("tracker.save")}
							size="lg"
							disabled={coverBusy}
							onPress={save}
							style={styles.grow}
							testID="book-save"
						/>
					</View>
				}
			>
				<View style={styles.body}>
					{photos ? (
						<CoverPicker
							cover={cover}
							title={typeof values.title === "string" ? values.title : ""}
							busy={coverBusy}
							onBusy={setCoverBusy}
							onChange={setCover}
						/>
					) : null}
					{specs.map((spec) => (
						<FieldRenderer
							key={spec.key}
							spec={spec}
							value={values[spec.key]}
							onChange={(value) => setValue(spec, value)}
							error={errors[spec.key]}
						/>
					))}
				</View>
			</Sheet>
			<ConfirmSheet
				open={confirmDelete}
				title={t.t("tracker.reading.deleteBook")}
				body={t.t("tracker.reading.deleteBookBody")}
				confirmLabel={t.t("common.delete")}
				destructive
				onConfirm={remove}
				onClose={() => setConfirmDelete(false)}
			/>
		</>
	);
}

/** The book's cover: a photo of it, kept like any other (re-encoded, on this device). */
function CoverPicker({
	cover,
	title,
	busy,
	onBusy,
	onChange,
}: {
	cover: AttachmentRef | null;
	title: string;
	busy: boolean;
	onBusy(busy: boolean): void;
	onChange(cover: AttachmentRef | null): void;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const [menu, setMenu] = useState(false);
	const alt = title.trim()
		? t.t("tracker.reading.coverAlt", { title: title.trim() })
		: t.t("tracker.reading.cover");
	const pick = async (source: "camera" | "library") => {
		const images = await pickWithFeedback(source, 1, t);
		const image = images?.[0];
		if (!image) return;
		onBusy(true);
		try {
			onChange(await savePhoto(image));
			haptics.light();
		} catch (error) {
			photoFailed(error, t);
		} finally {
			onBusy(false);
		}
	};
	return (
		<View style={styles.cover}>
			{busy ? (
				<View
					style={[styles.coverBox, styles.coverEmpty]}
					accessible
					accessibilityLabel={t.t("tracker.photo.preparing")}
				>
					<ActivityIndicator color={colors.textMuted} />
				</View>
			) : cover ? (
				<View style={styles.coverBox}>
					<PhotoThumb photo={cover} alt={alt} ratio={2 / 3} radius={8} />
				</View>
			) : (
				<View
					style={[styles.coverBox, styles.coverEmpty, styles.coverDashed]}
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
				>
					<Text style={styles.coverEmoji} allowFontScaling={false}>
						📖
					</Text>
				</View>
			)}
			<View style={styles.coverText}>
				<Text variant="small" weight="medium">
					{t.t("tracker.reading.cover")}
				</Text>
				<View style={styles.coverActions}>
					<Button
						label={cover ? t.t("tracker.reading.changeCover") : t.t("tracker.reading.addCover")}
						icon={ImagePlus}
						variant="secondary"
						size="sm"
						disabled={busy}
						onPress={() => {
							haptics.selection();
							setMenu(true);
						}}
						testID="book-cover"
					/>
					{cover ? (
						<Button
							label={t.t("tracker.reading.removeCover")}
							icon={X}
							variant="ghost"
							size="sm"
							disabled={busy}
							onPress={() => {
								haptics.selection();
								onChange(null);
							}}
						/>
					) : null}
				</View>
			</View>
			<PhotoSourceSheet
				open={menu}
				title={cover ? t.t("tracker.reading.changeCover") : t.t("tracker.reading.addCover")}
				multiple={false}
				onClose={() => setMenu(false)}
				onPick={(source) => void pick(source)}
			/>
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	body: { gap: 20 },
	cover: { flexDirection: "row", alignItems: "center", gap: 14 },
	coverBox: { width: 56 },
	coverEmpty: {
		height: 84,
		borderRadius: 8,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: t.colors.sunken,
	},
	coverDashed: { borderWidth: 1.5, borderStyle: "dashed", borderColor: t.colors.borderStrong },
	coverEmoji: { fontSize: 22, lineHeight: 28 },
	coverText: { flex: 1, minWidth: 0, gap: 6, alignItems: "flex-start" },
	coverActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
	footer: { flexDirection: "row", alignItems: "center", gap: 10 },
	grow: { flex: 1 },
	danger: { color: t.colors.danger },
}));
