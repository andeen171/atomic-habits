import { Languages } from "@/components/icons";
import { Text, type TextProps } from "@/components/ui/text";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { makeStyles, useTheme } from "@/lib/theme";
import type { Collection, MessageKey } from "@atomic/core";
import { useText } from "@atomic/core/react";
import {
	Pressable,
	type StyleProp,
	StyleSheet,
	type TextStyle,
	View,
	type ViewStyle,
} from "react-native";
import { create } from "zustand";

/** Collections whose text can be shown translated (Annex C §1.8; never the journal). */
export type TranslatableCollection = Extract<
	Collection,
	"habits" | "identities" | "tasks" | "scorecard"
>;

export interface TranslatedTextProps extends Omit<TextProps, "children"> {
	collection: TranslatableCollection;
	/** The document (habit, identity, task, scorecard item). */
	entity: Record<string, unknown>;
	field: string;
}

/** Texts the user switched back to the original, for as long as the app runs. */
const useShowOriginal = create<{ shown: ReadonlySet<string>; toggle(key: string): void }>(
	(set) => ({
		shown: new Set<string>(),
		toggle: (key) =>
			set((state) => {
				const shown = new Set(state.shown);
				if (shown.has(key)) shown.delete(key);
				else shown.add(key);
				return { shown };
			}),
	}),
);

/** Style keys that place the element (they move to the wrapper when the marker shows). */
const LAYOUT_KEYS = new Set<string>([
	"flex",
	"flexGrow",
	"flexShrink",
	"flexBasis",
	"alignSelf",
	"width",
	"minWidth",
	"maxWidth",
	"margin",
	"marginTop",
	"marginBottom",
	"marginLeft",
	"marginRight",
	"marginHorizontal",
	"marginVertical",
	"marginStart",
	"marginEnd",
	"position",
	"top",
	"bottom",
	"left",
	"right",
	"zIndex",
]);

function splitStyle(style: StyleProp<TextStyle>): { layout: ViewStyle; rest: TextStyle } {
	const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
	const layout: Record<string, unknown> = {};
	const rest: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(flat)) {
		if (LAYOUT_KEYS.has(key)) layout[key] = value;
		else rest[key] = value;
	}
	return { layout: layout as ViewStyle, rest: rest as TextStyle };
}

/**
 * A document's text in the content language (Annex C §1.8, D32), for detail
 * views (the habit screen title, identity cards). When the text is a
 * translation (template phrasebook or AI), a line under it says so —
 * "Translated from Portuguese" — with a "Show original" toggle
 * (`accessibilityState.selected`, remembered while the app runs); the
 * original keeps its own language for VoiceOver. Without a translation it is
 * exactly the `Text` it replaces. Lists use `useText` directly, without a
 * marker. Owner: T5.
 */
export function TranslatedText({
	collection,
	entity,
	field,
	style,
	...textProps
}: TranslatedTextProps) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const text = useText();
	const info = text.info(collection, entity, field);
	const id = typeof entity.id === "string" ? entity.id : "";
	const key = `${collection}:${id}:${field}`;
	const original = useShowOriginal((s) => s.shown.has(key));
	const toggle = useShowOriginal((s) => s.toggle);

	if (info.source === "original")
		return (
			<Text style={style} {...textProps}>
				{info.text}
			</Text>
		);

	const raw = entity[field];
	const shown = original && typeof raw === "string" ? raw : info.text;
	const language =
		info.from === "en" || info.from === "pt-BR"
			? t.t("ai.translated", { language: t.t(`ai.language.${info.from}` as MessageKey) })
			: t.t("ai.translatedPlain");
	// The wrapper takes the host's placement (flex, margins) so its layout holds.
	const { layout, rest } = splitStyle(style);
	return (
		<View style={[styles.wrap, layout]}>
			<Text
				{...textProps}
				style={rest}
				accessibilityLanguage={original && info.from ? info.from : undefined}
			>
				{shown}
			</Text>
			<View style={styles.marker}>
				<View style={styles.from}>
					<Languages size={14} color={colors.textMuted} strokeWidth={2} />
					<Text variant="small" tone="muted" style={styles.fromText}>
						{language}
					</Text>
				</View>
				<Pressable
					onPress={() => {
						haptics.selection();
						toggle(key);
					}}
					hitSlop={9}
					accessibilityRole="button"
					accessibilityLabel={t.t("ai.showOriginal")}
					accessibilityState={{ selected: original }}
					style={({ pressed }) => [
						styles.pill,
						original
							? { backgroundColor: colors.text, borderColor: colors.text }
							: pressed && { backgroundColor: colors.hover },
					]}
					testID={`show-original-${collection}-${field}`}
				>
					<Text
						variant="tiny"
						weight="semibold"
						color={original ? colors.bg : colors.text}
						numberOfLines={1}
					>
						{t.t("ai.showOriginal")}
					</Text>
				</Pressable>
			</View>
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	wrap: { minWidth: 0 },
	marker: {
		flexDirection: "row",
		flexWrap: "wrap",
		alignItems: "center",
		columnGap: 10,
		rowGap: 6,
		marginTop: 6,
	},
	from: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
	fromText: { flexShrink: 1 },
	pill: {
		height: 26,
		paddingHorizontal: 11,
		borderRadius: 999,
		borderWidth: 1,
		borderColor: t.colors.border,
		backgroundColor: t.colors.surface,
		alignItems: "center",
		justifyContent: "center",
	},
}));
