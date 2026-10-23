import { Sparkles } from "@/components/icons";
import { PressableScale } from "@/components/ui/pressable-scale";
import { retryConnection, useAiConsent } from "@/lib/ai";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { showToast } from "@/lib/ui-store";
import { type AiSuggestKind, aiSuggestInputSchemas } from "@atomic/core";
import { useState } from "react";
import { Keyboard } from "react-native";
import {
	type AiSuggestPick,
	type AiSuggestRequest,
	AiSuggestSheet,
	resolveAiInput,
} from "./ai-suggest-sheet";
import { useAi } from "./ai-ui";

export type { AiSuggestPick } from "./ai-suggest-sheet";

export interface AiSuggestButtonProps<K extends AiSuggestKind> {
	kind: K;
	/**
	 * The request input. A function is called when the sheet opens, so it
	 * reads the fields' latest values.
	 */
	input: AiSuggestRequest<K>;
	/** What it suggests for ("Name"); its accessible name is `ai.suggestFor`. */
	label: string;
	/** Inserts the pick as ordinary user text (the host decides where). */
	onPick: (pick: AiSuggestPick<K>) => void;
	disabled?: boolean;
}

const SIZE = 36;

/**
 * The sparkle button that opens `ai-suggest-sheet.tsx` (Annex C §1.6 and §5;
 * spec §5.4 lists where it goes):
 * - nothing without an account or on a server without AI (graceful absence);
 * - dimmed while the field it needs is empty;
 * - offline: dimmed, and a tap says "AI suggestions need a connection" and
 *   tries the server again;
 * - consent missing: the consent sheet first, then the suggestions;
 * - a long press names it (there are no tooltips on touch screens).
 * The keyboard goes down when the sheet opens. Only an explicit tap sends
 * anything; the journal never does (D19). Owner: T5.
 */
export function AiSuggestButton<K extends AiSuggestKind>({
	kind,
	input,
	label,
	onPick,
	disabled,
}: AiSuggestButtonProps<K>) {
	const t = useT();
	const { colors } = useTheme();
	const ai = useAi();
	const ask = useAiConsent((s) => s.ask);
	const [open, setOpen] = useState(false);
	/** Bumped on every opening: the sheet asks again with the latest field values. */
	const [session, setSession] = useState(0);
	const { availability } = ai;
	if (availability.status === "hidden" || !availability.suggest) return null;

	const valid = aiSuggestInputSchemas[kind].safeParse(resolveAiInput(input)).success;
	const offline = availability.status === "offline";
	// "Fill the four laws" is already an action; the others (a blueprint slot too) name a field.
	const action = kind === "habit.laws" && label === t.t("form.fillLaws");
	const name = action ? label : t.t("ai.suggestFor", { field: label });
	const inert = offline || disabled || !valid;

	const show = () => {
		setSession((value) => value + 1);
		setOpen(true);
	};

	const press = () => {
		if (offline) {
			haptics.warning();
			showToast(t.t("ai.error.offline"));
			retryConnection();
			return;
		}
		if (inert) return;
		haptics.light();
		Keyboard.dismiss();
		// Consent first; the suggestions open once it's given.
		if (availability.status === "needs-consent") ask(show);
		else show();
	};

	return (
		<>
			<PressableScale
				onPress={press}
				onLongPress={() => {
					haptics.selection();
					showToast(offline ? t.t("ai.error.offline") : name);
				}}
				scaleTo={0.9}
				hitSlop={(44 - SIZE) / 2}
				accessibilityRole="button"
				accessibilityLabel={name}
				accessibilityHint={offline ? t.t("ai.error.offline") : undefined}
				accessibilityState={{ disabled: inert, expanded: open }}
				style={{
					width: SIZE,
					height: SIZE,
					borderRadius: SIZE / 2,
					alignItems: "center",
					justifyContent: "center",
					backgroundColor: open ? colors.accentSoft : "transparent",
					opacity: inert ? 0.4 : 1,
				}}
				testID={`ai-suggest-${kind}`}
			>
				<Sparkles size={19} color={colors.accentText} strokeWidth={2} />
			</PressableScale>
			<AiSuggestSheet
				open={open}
				session={session}
				kind={kind}
				input={input}
				title={name}
				ai={ai}
				onPick={(pick) => {
					setOpen(false);
					onPick(pick);
				}}
				onClose={() => setOpen(false)}
				onNeedConsent={() => {
					setOpen(false);
					ask(show);
				}}
			/>
		</>
	);
}
