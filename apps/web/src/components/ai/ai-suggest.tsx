import { useAuthDialog } from "@/lib/account";
import { aiClient, useAiConsent } from "@/lib/ai";
import { useT } from "@/lib/messages";
import { cn } from "@/lib/utils";
import {
	AiError,
	type AiSuggestInput,
	type AiSuggestKind,
	type AiSuggestOutput,
	aiErrorKey,
	aiSuggestInputSchemas,
} from "@atomic/core";
import { useLocale } from "@atomic/core/react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Link } from "@tanstack/react-router";
import {
	CloudOff,
	Crown,
	LogIn,
	MailWarning,
	RefreshCw,
	Sparkles,
	TriangleAlert,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Spinner } from "../account/account-ui";
import { formatClock } from "../account/format";
import { useResendVerification } from "../account/verify-banner";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { AiBadge, AiCaption, type AiContext, useAi } from "./ai-ui";

/**
 * What one pick hands back: an item of `items` for the list kinds, or the
 * whole object for `habit.laws`.
 */
export type AiSuggestPick<K extends AiSuggestKind> = AiSuggestOutput<K> extends {
	items: readonly (infer I)[];
}
	? I
	: AiSuggestOutput<K>;

export interface AiSuggestProps<K extends AiSuggestKind> {
	kind: K;
	/**
	 * The request input. A function is called when the popover opens, so it
	 * reads the fields' latest values.
	 */
	input: AiSuggestInput<K> | (() => AiSuggestInput<K>);
	/** What it suggests for ("Name"); the button's accessible name is `ai.suggestFor {label}`. */
	label: string;
	/** Inserts the pick as ordinary user text (undoable; the host decides where). */
	onPick(pick: AiSuggestPick<K>): void;
	disabled?: boolean;
	className?: string;
}

/**
 * Whether the last keyboard action was Tab: the sparkle's tooltip shows on
 * hover and on Tab focus, not when focus comes back to it from its popover
 * or the consent dialog (so one Esc still closes the dialog around it).
 */
let tabbed = false;
if (typeof document !== "undefined") {
	document.addEventListener(
		"keydown",
		(event) => {
			tabbed = event.key === "Tab";
		},
		true,
	);
	document.addEventListener(
		"pointerdown",
		() => {
			tabbed = false;
		},
		true,
	);
}

const resolve = <K extends AiSuggestKind>(input: AiSuggestProps<K>["input"]) =>
	typeof input === "function" ? (input as () => AiSuggestInput<K>)() : input;

/**
 * The sparkle button and its suggestions popover (Annex C §1.6 and §4,
 * spec §5.4 for where it goes):
 * - hidden without an account, on a server without AI, and in the artifact
 *   build (graceful absence); disabled while the field it needs is empty;
 * - offline: shown but inert, with "AI suggestions need a connection";
 * - consent missing: the consent dialog first, then the suggestions;
 * - the popover lists 3–5 suggestions (skeleton and a hidden "Thinking…"
 *   while loading), errors inline with what can be done (Upgrade, Resend
 *   email, Try again), "Try others", and the "AI · Beta" caption.
 * Only an explicit tap sends anything; the journal never does (D19).
 * Owner: T5.
 */
export function AiSuggest<K extends AiSuggestKind>({
	kind,
	input,
	label,
	onPick,
	disabled,
	className,
}: AiSuggestProps<K>) {
	const { t } = useT();
	const ai = useAi();
	const ask = useAiConsent((s) => s.ask);
	const [open, setOpen] = useState(false);
	const [tip, setTip] = useState(false);
	const hovering = useRef(false);
	const { availability } = ai;
	if (!aiClient || availability.status === "hidden" || !availability.suggest) return null;

	const valid = aiSuggestInputSchemas[kind].safeParse(resolve(input)).success;
	const offline = availability.status === "offline";
	// "Fill the four laws" is already an action; the others name a field.
	const name = kind === "habit.laws" ? label : t("ai.suggestFor", { field: label });
	const inert = offline || disabled || !valid;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<TooltipPrimitive.Root
				open={tip && !open}
				onOpenChange={(next) => setTip(next && (hovering.current || tabbed))}
			>
				<TooltipPrimitive.Trigger asChild>
					<PopoverTrigger asChild>
						<button
							type="button"
							aria-label={name}
							aria-disabled={inert || undefined}
							onPointerEnter={() => {
								hovering.current = true;
							}}
							onPointerLeave={() => {
								hovering.current = false;
							}}
							onClick={(event) => {
								if (inert) {
									event.preventDefault();
									return;
								}
								if (availability.status === "needs-consent") {
									// Consent first; the suggestions open once it's given.
									event.preventDefault();
									ask(() => setOpen(true));
								}
							}}
							className={cn(
								"before:-inset-1.5 relative inline-grid size-8 shrink-0 place-items-center rounded-full text-accent-text transition-[background-color,opacity] duration-(--atomic-duration-fast) before:absolute before:content-[''] hover:bg-accent-soft data-[state=open]:bg-accent-soft [&_svg]:size-[18px]",
								inert && "cursor-default opacity-40 hover:bg-transparent",
								className,
							)}
						>
							<Sparkles aria-hidden="true" />
						</button>
					</PopoverTrigger>
				</TooltipPrimitive.Trigger>
				<TooltipPrimitive.Portal>
					<TooltipPrimitive.Content
						side="top"
						sideOffset={6}
						collisionPadding={8}
						className="z-50 max-w-64 rounded-sm bg-ink px-2.5 py-1.5 font-medium text-bg text-small shadow-pop data-[state=closed]:animate-fade-out data-[state=delayed-open]:animate-fade-in"
					>
						{offline ? t("ai.error.offline") : name}
					</TooltipPrimitive.Content>
				</TooltipPrimitive.Portal>
			</TooltipPrimitive.Root>
			<PopoverContent
				align="end"
				className="flex w-[min(22rem,calc(100vw-16px))] flex-col p-0"
				aria-label={name}
			>
				{open ? (
					<SuggestPanel
						kind={kind}
						input={input}
						label={label}
						ai={ai}
						onPick={(pick) => {
							setOpen(false);
							onPick(pick);
						}}
						onClose={() => setOpen(false)}
						onNeedConsent={() => {
							setOpen(false);
							ask(() => setOpen(true));
						}}
					/>
				) : null}
			</PopoverContent>
		</Popover>
	);
}

type PanelState<K extends AiSuggestKind> =
	| { status: "loading" }
	| { status: "done"; output: AiSuggestOutput<K> }
	| { status: "error"; error: AiError };

function SuggestPanel<K extends AiSuggestKind>({
	kind,
	input,
	label,
	ai,
	onPick,
	onClose,
	onNeedConsent,
}: {
	kind: K;
	input: AiSuggestProps<K>["input"];
	label: string;
	ai: AiContext;
	onPick(pick: AiSuggestPick<K>): void;
	onClose(): void;
	onNeedConsent(): void;
}) {
	const { t } = useT();
	const locale = useLocale();
	const [state, setState] = useState<PanelState<K>>({ status: "loading" });
	/** 0: the first answer (cached when asked before); then "Try others" / "Try again". */
	const [round, setRound] = useState(0);
	const [fresh, setFresh] = useState(false);
	const listRef = useRef<HTMLDivElement | null>(null);
	// The input is read when the popover opens (the host's latest field values).
	const [request] = useState(() => aiSuggestInputSchemas[kind].safeParse(resolve(input)));
	const needConsent = useRef(onNeedConsent);
	needConsent.current = onNeedConsent;

	// biome-ignore lint/correctness/useExhaustiveDependencies: one request per round
	useEffect(() => {
		const client = aiClient;
		if (!client) return;
		if (!request.success) {
			setState({ status: "error", error: new AiError("failed") });
			return;
		}
		const controller = new AbortController();
		setState({ status: "loading" });
		client
			.suggest(kind, request.data as AiSuggestInput<K>, locale, {
				signal: controller.signal,
				fresh,
			})
			.then(({ output }) => {
				if (!controller.signal.aborted) setState({ status: "done", output });
			})
			.catch((failure: unknown) => {
				if (controller.signal.aborted) return;
				const error = failure instanceof AiError ? failure : new AiError("failed");
				if (error.kind === "aborted") return;
				if (error.kind === "consent") {
					needConsent.current();
					return;
				}
				setState({ status: "error", error });
			});
		return () => controller.abort();
	}, [round]);

	// Keyboard users land on the first suggestion once they arrive (unless
	// they already moved somewhere inside the popover).
	useEffect(() => {
		if (state.status !== "done") return;
		const list = listRef.current;
		const popover = list?.closest<HTMLElement>('[role="dialog"]');
		const active = document.activeElement;
		if (list && (active === popover || active === document.body || !active))
			list.querySelector<HTMLButtonElement>("button")?.focus();
	}, [state.status]);

	const again = (others: boolean) => {
		setFresh(others);
		setRound((value) => value + 1);
	};

	const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
		const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
		if (index < 0) return;
		event.preventDefault();
		const next = (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
		buttons[next]?.focus();
	};

	const loading = state.status === "loading";
	return (
		<>
			<div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-2">
				<p className="flex min-w-0 items-start gap-2 font-semibold text-ink text-small leading-snug">
					<Sparkles aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-text" />
					<span className="min-w-0">
						{kind === "habit.laws" ? label : t("ai.suggestFor", { field: label })}
					</span>
				</p>
				{ai.availability.beta ? <AiBadge className="mt-px" /> : null}
			</div>
			<div className="px-2 pb-2" aria-busy={loading || undefined}>
				{loading ? (
					<div className="flex flex-col gap-1.5 px-2 py-1.5">
						<output className="sr-only">{t("ai.loading")}</output>
						{[86, 64, 74].map((width) => (
							<span
								key={width}
								aria-hidden="true"
								className="h-8 animate-pulse rounded-md bg-sunken motion-reduce:animate-none"
								style={{ width: `${width}%` }}
							/>
						))}
					</div>
				) : state.status === "error" ? (
					<ErrorBlock error={state.error} ai={ai} onRetry={() => again(false)} onClose={onClose} />
				) : (
					<div ref={listRef} onKeyDown={onListKeyDown}>
						<Suggestions kind={kind} output={state.output} input={request} onPick={onPick} />
					</div>
				)}
			</div>
			<div className="flex items-center justify-between gap-3 border-line border-t px-3 py-1.5">
				<AiCaption beta={ai.availability.beta} className="pl-1" />
				<Button
					variant="ghost"
					size="sm"
					disabled={loading || state.status === "error"}
					onClick={() => again(true)}
				>
					<RefreshCw
						className={cn(loading && fresh && "animate-spin motion-reduce:animate-none")}
					/>
					{t("ai.again")}
				</Button>
			</div>
		</>
	);
}

const itemClass =
	"flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left text-body text-ink leading-snug transition-colors duration-(--atomic-duration-fast) hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2";

function Suggestions<K extends AiSuggestKind>({
	kind,
	output,
	input,
	onPick,
}: {
	kind: K;
	output: AiSuggestOutput<K>;
	input: { success: boolean; data?: unknown };
	onPick(pick: AiSuggestPick<K>): void;
}) {
	const { t } = useT();
	const habitKind =
		(input.data as { kind?: string } | undefined)?.kind === "break" ? "break" : "build";
	const lawName = (law: 1 | 2 | 3 | 4) =>
		t(habitKind === "break" ? `law.${law}.inverse` : `law.${law}.name`);
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
			<div className="flex flex-col gap-3 px-2 pt-1 pb-1.5">
				<dl className="flex flex-col gap-2.5">
					{rows.map(([law, text]) => (
						<div key={law}>
							<dt className="section-label">{lawName(law)}</dt>
							<dd className="mt-0.5 text-ink text-small leading-snug">{text}</dd>
						</div>
					))}
				</dl>
				<Button size="sm" className="self-start" onClick={() => pick(laws)}>
					{t("ai.useAll")}
				</Button>
			</div>
		);
	}

	const items = (output as { items: readonly unknown[] }).items;
	return (
		<ul className="flex flex-col">
			{items.map((item, index) => {
				let main: string;
				let detail: ReactNode = null;
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
					// biome-ignore lint/suspicious/noArrayIndexKey: suggestions are positional and may repeat text
					<li key={index}>
						<button type="button" className={itemClass} onClick={() => pick(item)}>
							<span className="break-words">{main}</span>
							{detail ? <span className="text-ink-muted text-small">{detail}</span> : null}
						</button>
					</li>
				);
			})}
		</ul>
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
	const { t } = useT();
	const locale = useLocale();
	const openAuth = useAuthDialog((s) => s.openAuth);
	const { sending, resend } = useResendVerification();
	const { availability, limits, billing, plan, proSuggestions } = ai;

	let message: string;
	let icon: ReactNode = <TriangleAlert />;
	let actions: ReactNode = null;
	if (error.kind === "quota") {
		const count = availability.quota.suggest?.limit ?? limits?.aiRequestsPerDay ?? 0;
		const resetsAt =
			error.resetsAt ?? availability.blockedUntil.suggest ?? availability.quota.suggest?.resetsAt;
		message = t("ai.error.quota", {
			count,
			time: resetsAt ? formatClock(resetsAt, locale) : "00:00",
		});
		if (billing && plan === "free" && proSuggestions) {
			actions = (
				<Button asChild size="sm" variant="soft">
					<Link to="/account" onClick={onClose}>
						<Crown />
						{t("ai.upgradeForMore", { count: proSuggestions })}
					</Link>
				</Button>
			);
		}
	} else if (error.kind === "unverified") {
		icon = <MailWarning />;
		message = t("ai.error.unverified");
		actions = (
			<Button size="sm" variant="secondary" disabled={sending} onClick={() => void resend()}>
				{sending ? <Spinner /> : null}
				{t("account.verifyResend")}
			</Button>
		);
	} else if (error.kind === "auth") {
		icon = <LogIn />;
		message = t("account.errors.sessionEnded");
		actions = (
			<Button
				size="sm"
				variant="secondary"
				onClick={() => {
					onClose();
					openAuth("signIn");
				}}
			>
				{t("account.signInAgain")}
			</Button>
		);
	} else {
		if (error.kind === "offline") icon = <CloudOff />;
		message = t(aiErrorKey(error) ?? "ai.error.failed");
		actions = (
			<Button size="sm" variant="secondary" onClick={onRetry}>
				<RefreshCw />
				{t("account.retry")}
			</Button>
		);
	}

	return (
		<div role="alert" className="mx-1 my-1 flex flex-col gap-3 rounded-lg bg-sunken p-3.5">
			<p className="flex items-start gap-2.5 text-ink text-small leading-snug">
				<span aria-hidden="true" className="mt-0.5 shrink-0 text-ink-muted [&_svg]:size-4">
					{icon}
				</span>
				<span className="min-w-0">{message}</span>
			</p>
			{actions ? <div className="flex flex-wrap gap-2 pl-6.5">{actions}</div> : null}
		</div>
	);
}
