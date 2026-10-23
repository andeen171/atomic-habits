import {
	CloudOff,
	Crown,
	LogIn,
	type LucideIcon,
	MailWarning,
	RefreshCw,
	TriangleAlert,
} from "@/components/icons";
import { Sheet } from "@/components/sheet/sheet";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAuthSheet } from "@/lib/account";
import { aiClient } from "@/lib/ai";
import { haptics } from "@/lib/haptics";
import { useT } from "@/lib/i18n";
import { useReduceMotion } from "@/lib/motion";
import { makeStyles, useTheme } from "@/lib/theme";
import {
	AiError,
	type AiSuggestInput,
	type AiSuggestKind,
	type AiSuggestOutput,
	aiErrorKey,
	aiSuggestInputSchemas,
} from "@atomic/core";
import { useLocale } from "@atomic/core/react";
import { router } from "expo-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, View } from "react-native";
import Animated, {
	cancelAnimation,
	useAnimatedStyle,
	useSharedValue,
	withRepeat,
	withTiming,
} from "react-native-reanimated";
import { formatClock } from "../account/format";
import { useResendVerification } from "../account/verify-notice";
import { AiBadge, AiCaption, type AiContext, AiTile } from "./ai-ui";

/**
 * What one pick hands back: an item of `items` for the list kinds, or the
 * whole object for `habit.laws`.
 */
export type AiSuggestPick<K extends AiSuggestKind> = AiSuggestOutput<K> extends {
	items: readonly (infer I)[];
}
	? I
	: AiSuggestOutput<K>;

export type AiSuggestRequest<K extends AiSuggestKind> =
	| AiSuggestInput<K>
	| (() => AiSuggestInput<K>);

export const resolveAiInput = <K extends AiSuggestKind>(input: AiSuggestRequest<K>) =>
	typeof input === "function" ? (input as () => AiSuggestInput<K>)() : input;

/**
 * The suggestions sheet a sparkle opens (Annex C §1.6 and §5): a header with
 * the sparkle, what it suggests for and "Beta"; a skeleton (read out as
 * "Thinking…") while the server answers; 3–5 suggestions as full-width rows
 * (intentions show "time · place", setup tasks their law; "Fill the four
 * laws" lists all four, or the inverted laws for a break habit, with "Use
 * these"); errors inline with what can be done; and a footer with the
 * "AI · Beta" caption and "Try others". Each opening reads the fields once.
 * Screen readers land on the first suggestion. Owner: T5.
 */
export function AiSuggestSheet<K extends AiSuggestKind>({
	open,
	session,
	kind,
	input,
	title,
	ai,
	onPick,
	onClose,
	onNeedConsent,
}: {
	open: boolean;
	/** Bumped on every opening: a fresh request with the latest field values. */
	session: number;
	kind: K;
	input: AiSuggestRequest<K>;
	title: string;
	ai: AiContext;
	onPick(pick: AiSuggestPick<K>): void;
	onClose(): void;
	onNeedConsent(): void;
}) {
	return (
		<Sheet open={open} onClose={onClose} scroll testID="ai-suggest-sheet">
			{session > 0 ? (
				<SuggestPanel
					key={session}
					active={open}
					kind={kind}
					input={input}
					title={title}
					ai={ai}
					onPick={onPick}
					onClose={onClose}
					onNeedConsent={onNeedConsent}
				/>
			) : null}
		</Sheet>
	);
}

type PanelState<K extends AiSuggestKind> =
	| { status: "loading" }
	| { status: "done"; output: AiSuggestOutput<K> }
	| { status: "error"; error: AiError };

function SuggestPanel<K extends AiSuggestKind>({
	active,
	kind,
	input,
	title,
	ai,
	onPick,
	onClose,
	onNeedConsent,
}: {
	active: boolean;
	kind: K;
	input: AiSuggestRequest<K>;
	title: string;
	ai: AiContext;
	onPick(pick: AiSuggestPick<K>): void;
	onClose(): void;
	onNeedConsent(): void;
}) {
	const t = useT();
	const styles = useStyles();
	const locale = useLocale();
	const [state, setState] = useState<PanelState<K>>({ status: "loading" });
	/** 0: the first answer (cached when asked before); then "Try others" / "Try again". */
	const [round, setRound] = useState(0);
	const [fresh, setFresh] = useState(false);
	// The input is read when the sheet opens (the host's latest field values).
	const [request] = useState(() => aiSuggestInputSchemas[kind].safeParse(resolveAiInput(input)));
	const needConsent = useRef(onNeedConsent);
	needConsent.current = onNeedConsent;
	const firstRef = useRef<View | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: one request per round while open
	useEffect(() => {
		if (!active) return;
		if (!request.success) {
			setState({ status: "error", error: new AiError("failed") });
			return;
		}
		const controller = new AbortController();
		setState({ status: "loading" });
		aiClient
			.suggest(kind, request.data as AiSuggestInput<K>, locale, {
				signal: controller.signal,
				fresh,
			})
			.then(({ output }) => {
				if (controller.signal.aborted) return;
				haptics.light();
				setState({ status: "done", output });
			})
			.catch((failure: unknown) => {
				if (controller.signal.aborted) return;
				const error = failure instanceof AiError ? failure : new AiError("failed");
				if (error.kind === "aborted") return;
				if (error.kind === "consent") {
					needConsent.current();
					return;
				}
				haptics.warning();
				setState({ status: "error", error });
			});
		return () => controller.abort();
	}, [round, active]);

	// Screen readers move to the first suggestion once they arrive.
	useEffect(() => {
		if (state.status !== "done" || Platform.OS === "web") return;
		let cancelled = false;
		const timer = setTimeout(() => {
			void AccessibilityInfo.isScreenReaderEnabled().then((on) => {
				const node = firstRef.current;
				if (on && node && !cancelled) AccessibilityInfo.sendAccessibilityEvent(node, "focus");
			});
		}, 250);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [state.status]);

	const again = (others: boolean) => {
		haptics.selection();
		setFresh(others);
		setRound((value) => value + 1);
	};

	const loading = state.status === "loading";
	return (
		<View style={styles.panel}>
			<View style={styles.header}>
				<AiTile />
				<Text variant="h3" accessibilityRole="header" style={styles.title}>
					{title}
				</Text>
				{ai.availability.beta ? <AiBadge style={styles.headerBadge} /> : null}
			</View>
			{loading ? (
				<Skeleton label={t.t("ai.loading")} />
			) : state.status === "error" ? (
				<ErrorBlock error={state.error} ai={ai} onRetry={() => again(false)} onClose={onClose} />
			) : (
				<Suggestions
					kind={kind}
					output={state.output}
					input={request}
					onPick={onPick}
					firstRef={firstRef}
				/>
			)}
			<View style={styles.footer}>
				<AiCaption beta={ai.availability.beta} />
				<Button
					label={t.t("ai.again")}
					icon={RefreshCw}
					variant="ghost"
					size="sm"
					disabled={loading || state.status === "error"}
					onPress={() => again(true)}
					testID="ai-suggest-again"
				/>
			</View>
		</View>
	);
}

/** Three soft bars that breathe while the answer comes (still under reduce motion). */
function Skeleton({ label }: { label: string }) {
	const styles = useStyles();
	const reduceMotion = useReduceMotion();
	const pulse = useSharedValue(1);
	useEffect(() => {
		if (reduceMotion) return;
		pulse.value = withRepeat(withTiming(0.45, { duration: 700 }), -1, true);
		return () => cancelAnimation(pulse);
	}, [reduceMotion, pulse]);
	const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
	return (
		<View
			accessible
			accessibilityRole="progressbar"
			accessibilityLabel={label}
			accessibilityState={{ busy: true }}
			accessibilityLiveRegion="polite"
			style={styles.skeleton}
			testID="ai-suggest-loading"
		>
			{[86, 64, 74].map((width) => (
				<Animated.View key={width} style={[styles.bar, { width: `${width}%` }, style]} />
			))}
		</View>
	);
}

function Suggestions<K extends AiSuggestKind>({
	kind,
	output,
	input,
	onPick,
	firstRef,
}: {
	kind: K;
	output: AiSuggestOutput<K>;
	input: { success: boolean; data?: unknown };
	onPick(pick: AiSuggestPick<K>): void;
	firstRef: { current: View | null };
}) {
	const t = useT();
	const styles = useStyles();
	const habitKind =
		(input.data as { kind?: string } | undefined)?.kind === "break" ? "break" : "build";
	const lawName = (law: 1 | 2 | 3 | 4) =>
		t.t(habitKind === "break" ? `law.${law}.inverse` : `law.${law}.name`);
	const pick = onPick as (value: unknown) => void;

	if (kind === "habit.laws") {
		const laws = output as AiSuggestOutput<"habit.laws">;
		const rows: [1 | 2 | 3 | 4, string][] = [
			[1, laws.obvious],
			[2, laws.attractive],
			[3, laws.easy],
			[4, laws.satisfying],
		];
		return (
			<View style={styles.laws} testID="ai-suggest-laws">
				{rows.map(([law, text], index) => (
					<View
						key={law}
						ref={index === 0 ? firstRef : undefined}
						accessible
						accessibilityLabel={`${lawName(law)}: ${text}`}
						style={styles.law}
					>
						<Text variant="label" tone="subtle">
							{lawName(law)}
						</Text>
						<Text>{text}</Text>
					</View>
				))}
				<Button
					label={t.t("ai.useAll")}
					onPress={() => pick(laws)}
					style={styles.useAll}
					testID="ai-suggest-use-all"
				/>
			</View>
		);
	}

	const items = (output as { items: readonly unknown[] }).items;
	return (
		<View style={styles.list} testID="ai-suggest-list">
			{items.map((item, index) => {
				let main: string;
				let detail: string | null = null;
				if (typeof item === "string") main = item;
				else if (kind === "habit.intention") {
					const intention = item as AiSuggestOutput<"habit.intention">["items"][number];
					main = intention.sentence;
					detail = intention.time
						? `${intention.time} · ${intention.location}`
						: intention.location;
				} else {
					const task = item as AiSuggestOutput<"habit.setupTasks">["items"][number];
					main = task.title;
					detail = lawName(task.law);
				}
				return (
					<SuggestionRow
						// biome-ignore lint/suspicious/noArrayIndexKey: suggestions are positional and may repeat text
						key={index}
						rowRef={index === 0 ? firstRef : undefined}
						main={main}
						detail={detail}
						onPress={() => pick(item)}
						testID={`ai-suggestion-${index}`}
					/>
				);
			})}
		</View>
	);
}

function SuggestionRow({
	main,
	detail,
	onPress,
	rowRef,
	testID,
}: {
	main: string;
	detail: string | null;
	onPress(): void;
	rowRef?: { current: View | null };
	testID?: string;
}) {
	const { colors } = useTheme();
	const styles = useStyles();
	return (
		<Pressable
			ref={rowRef}
			onPress={() => {
				haptics.selection();
				onPress();
			}}
			accessibilityRole="button"
			accessibilityLabel={detail ? `${main}, ${detail}` : main}
			style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.border }]}
			testID={testID}
		>
			<Text>{main}</Text>
			{detail ? (
				<Text variant="small" tone="muted">
					{detail}
				</Text>
			) : null}
		</Pressable>
	);
}

function ErrorBlock({
	error,
	ai,
	onRetry,
	onClose,
}: {
	error: AiError;
	ai: AiContext;
	onRetry(): void;
	onClose(): void;
}) {
	const t = useT();
	const { colors } = useTheme();
	const styles = useStyles();
	const locale = useLocale();
	const openAuth = useAuthSheet((s) => s.openAuth);
	const { sending, resend } = useResendVerification();
	const { availability, limits, billing, plan, proSuggestions } = ai;

	let message: string;
	let Icon: LucideIcon = TriangleAlert;
	let actions: ReactNode = null;
	if (error.kind === "quota") {
		const count = availability.quota.suggest?.limit ?? limits?.aiRequestsPerDay ?? 0;
		const resetsAt =
			error.resetsAt ?? availability.blockedUntil.suggest ?? availability.quota.suggest?.resetsAt;
		message = t.t("ai.error.quota", {
			count: t.number(count),
			time: resetsAt ? formatClock(resetsAt, locale) : "00:00",
		});
		if (billing && plan === "free" && proSuggestions) {
			actions = (
				<Button
					label={t.t("ai.upgradeForMore", { count: t.number(proSuggestions) })}
					icon={Crown}
					variant="secondary"
					size="sm"
					onPress={() => {
						onClose();
						router.push("/account");
					}}
				/>
			);
		}
	} else if (error.kind === "unverified") {
		Icon = MailWarning;
		message = t.t("ai.error.unverified");
		actions = (
			<Button
				label={t.t("account.verifyResend")}
				variant="secondary"
				size="sm"
				loading={sending}
				onPress={() => void resend()}
			/>
		);
	} else if (error.kind === "auth") {
		Icon = LogIn;
		message = t.t("account.errors.sessionEnded");
		actions = (
			<Button
				label={t.t("account.signInAgain")}
				variant="secondary"
				size="sm"
				onPress={() => {
					onClose();
					openAuth("signIn");
				}}
			/>
		);
	} else {
		if (error.kind === "offline") Icon = CloudOff;
		message = t.t(aiErrorKey(error) ?? "ai.error.failed");
		actions = (
			<Button
				label={t.t("account.retry")}
				icon={RefreshCw}
				variant="secondary"
				size="sm"
				onPress={onRetry}
				testID="ai-suggest-retry"
			/>
		);
	}

	return (
		<View
			accessibilityRole="alert"
			accessibilityLiveRegion="assertive"
			style={styles.error}
			testID="ai-suggest-error"
		>
			<View style={styles.errorLine}>
				<Icon size={17} color={colors.textMuted} strokeWidth={2.2} style={styles.errorIcon} />
				<Text style={styles.errorText}>{message}</Text>
			</View>
			{actions ? <View style={styles.errorActions}>{actions}</View> : null}
		</View>
	);
}

const useStyles = makeStyles((t) => ({
	panel: { gap: 14 },
	header: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 2 },
	title: { flex: 1 },
	headerBadge: { alignSelf: "center" },
	skeleton: { gap: 10, paddingVertical: 6 },
	bar: { height: 44, borderRadius: t.radii.md, backgroundColor: t.colors.sunken },
	list: { gap: 8 },
	row: {
		minHeight: 52,
		justifyContent: "center",
		gap: 2,
		paddingHorizontal: 14,
		paddingVertical: 12,
		borderRadius: t.radii.lg,
		backgroundColor: t.colors.sunken,
	},
	laws: { gap: 14 },
	law: { gap: 3 },
	useAll: { alignSelf: "flex-start", marginTop: 2 },
	error: {
		gap: 12,
		padding: 14,
		borderRadius: t.radii.lg,
		backgroundColor: t.colors.sunken,
	},
	errorLine: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
	errorIcon: { marginTop: 2 },
	errorText: { flex: 1 },
	errorActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingLeft: 27 },
	footer: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
		paddingTop: 10,
		marginTop: 2,
		borderTopWidth: 1,
		borderTopColor: t.colors.border,
	},
}));
