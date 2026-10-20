import { focusHeading } from "@/lib/focus";
import { useT } from "@/lib/messages";
import { type HabitTemplate, resolveSetupDrafts } from "@atomic/core";
import { useActions, useIdentities, useToday } from "@atomic/core/react";
import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BlueprintCard } from "../habit/blueprint-card";
import { TrackerReviewLine } from "../trackers/tracker-review-line";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { SegmentedControl } from "../ui/segmented";
import { type HabitDraft, applyTemplate, draftToInput, previewHabit } from "./draft";
import {
	BasicsFields,
	EasyFields,
	IdentityFields,
	ObviousFields,
	SatisfyingFields,
	TemplateList,
} from "./editor-steps";
import { HabitPreview } from "./habit-preview";
import { SetupTasksReview } from "./setup-tasks-review";

type EditorMode = "guided" | "quick";
const STEPS = ["what", "identity", "obvious", "easy", "satisfying", "review"] as const;
type Step = (typeof STEPS)[number];

interface HabitEditorProps {
	initial: HabitDraft;
	/** Present when editing an existing habit. */
	habitId?: string;
}

/** Guided four-laws wizard (default for new habits) or a single quick page (default for edits). */
export function HabitEditor({ initial, habitId }: HabitEditorProps) {
	const { t, at } = useT();
	const actions = useActions();
	const navigate = useNavigate();
	const router = useRouter();
	const canGoBack = useCanGoBack();
	const today = useToday();
	const identities = useIdentities();
	const editing = habitId !== undefined;

	const [draft, setDraft] = useState(initial);
	const [mode, setMode] = useState<EditorMode>(editing ? "quick" : "guided");
	const [step, setStep] = useState<Step>("what");
	const [direction, setDirection] = useState(1);
	const [nameError, setNameError] = useState(false);
	const stepRef = useRef<HTMLElement>(null);

	// Focus scrolling must keep fields clear of the sticky header and footer.
	useEffect(() => {
		const root = document.documentElement;
		root.dataset.stickyBars = "";
		return () => {
			delete root.dataset.stickyBars;
		};
	}, []);

	const update = useCallback((patch: Partial<HabitDraft>) => {
		setDraft((current) => ({ ...current, ...patch }));
		if (patch.name?.trim()) setNameError(false);
	}, []);

	const preview = useMemo(
		() => previewHabit(draft, at("form.previewEmpty"), today),
		[draft, at, today],
	);
	const identityStatement =
		draft.newIdentity?.trim() ||
		identities.find((i) => i.id === draft.identityId)?.statement ||
		null;
	const isBreak = draft.kind === "break";
	const index = STEPS.indexOf(step);

	const close = () => {
		if (canGoBack) router.history.back();
		else if (habitId) void navigate({ to: "/habits/$habitId", params: { habitId } });
		else void navigate({ to: "/habits" });
	};

	const goTo = (next: Step) => {
		setDirection(STEPS.indexOf(next) >= index ? 1 : -1);
		setStep(next);
		window.scrollTo({ top: 0 });
	};

	const validName = () => {
		if (draft.name.trim()) return true;
		setNameError(true);
		if (mode === "guided") goTo("what");
		return false;
	};

	const next = () => {
		if (step === "what" && !validName()) return;
		const following = STEPS[index + 1];
		if (following) goTo(following);
	};

	const save = () => {
		if (!validName()) return;
		let identityId = draft.identityId;
		const statement = draft.newIdentity?.trim();
		if (statement) identityId = actions.createIdentity({ statement, color: draft.color }).id;
		const input = draftToInput(draft, identityId);
		let savedId: string;
		if (habitId) {
			actions.updateHabit(habitId, input);
			savedId = habitId;
		} else {
			savedId = actions.createHabit(input).id;
		}
		// Setup tasks drafted with the habit (Annex T §4.4).
		const setup = resolveSetupDrafts(
			draft.setupTasks,
			{ environment: draft.environment, twoMinute: draft.twoMinute, reward: draft.reward },
			draft.kind,
		);
		if (setup.length) actions.createSetupTasks(savedId, setup);
		void navigate({ to: "/habits/$habitId", params: { habitId: savedId }, replace: true });
	};

	const pickTemplate = (template: HabitTemplate) => {
		setDraft((current) => applyTemplate(current, template));
		setNameError(false);
	};

	const stepTitle: Record<Step, { title: string; hint?: string }> = {
		what: { title: isBreak ? t("form.step.whatBreak") : t("form.step.what") },
		identity: { title: t("form.step.identity"), hint: t("form.step.identityHint") },
		obvious: isBreak
			? { title: t("form.step.invisible"), hint: t("form.step.invisibleHint") }
			: { title: t("form.step.obvious"), hint: t("form.step.obviousHint") },
		easy: isBreak
			? { title: t("form.step.difficult"), hint: t("form.step.difficultHint") }
			: { title: t("form.step.easy"), hint: t("form.step.easyHint") },
		satisfying: isBreak
			? { title: t("form.step.unsatisfying"), hint: t("form.step.unsatisfyingHint") }
			: { title: t("form.step.satisfying"), hint: t("form.step.satisfyingHint") },
		review: { title: t("form.step.review"), hint: t("form.step.reviewHint") },
	};

	const stepContent: Record<Step, ReactNode> = {
		what: (
			<>
				<BasicsFields
					draft={draft}
					update={update}
					nameError={nameError}
					onNameEnter={next}
					autoFocus={!editing}
					editing={editing}
				/>
				{editing ? null : <TemplateList draft={draft} onPick={pickTemplate} />}
			</>
		),
		identity: <IdentityFields draft={draft} update={update} />,
		obvious: <ObviousFields draft={draft} update={update} habitId={habitId} />,
		easy: <EasyFields draft={draft} update={update} habitId={habitId} />,
		satisfying: <SatisfyingFields draft={draft} update={update} habitId={habitId} />,
		review: (
			<div className="flex flex-col gap-6">
				<div className="rounded-xl border border-line bg-surface p-5 shadow-card md:p-6">
					<BlueprintCard habit={preview} identityStatement={identityStatement} editable={false} />
					<TrackerReviewLine draft={draft} />
				</div>
				<SetupTasksReview draft={draft} update={update} habitId={habitId} />
			</div>
		),
	};

	return (
		<div className="flex min-h-dvh flex-col">
			<header className="sticky top-0 z-20 border-line border-b bg-bg/85 backdrop-blur-xl">
				<div className="mx-auto flex min-h-16 w-full max-w-[1080px] items-center gap-3 px-4 py-2 md:px-8">
					<IconButton label={t("common.close")} onClick={close}>
						<X />
					</IconButton>
					{/* Two lines at most on narrow phones rather than an ellipsis. */}
					<h1 className="line-clamp-2 min-w-0 flex-1 break-words font-semibold text-ink leading-snug">
						{editing ? t("form.editTitle") : t("form.newTitle")}
					</h1>
					<SegmentedControl<EditorMode>
						label={`${t("form.guided")} / ${t("form.quick")}`}
						size="sm"
						className="shrink-0"
						value={mode}
						onChange={setMode}
						options={[
							{ value: "guided", label: t("form.guided") },
							{ value: "quick", label: t("form.quick") },
						]}
					/>
				</div>
			</header>

			<div className="mx-auto grid w-full max-w-[1080px] flex-1 grid-cols-1 gap-10 px-5 pt-6 pb-10 md:px-8 md:pt-10 lg:grid-cols-[minmax(0,1fr)_340px]">
				<main ref={stepRef} className="min-w-0">
					{mode === "guided" ? (
						<>
							<div className="mb-6 flex items-center gap-3">
								<span className="shrink-0 text-ink-muted text-small tabular-nums">
									{t("form.step", { current: index + 1, total: STEPS.length })}
								</span>
								<div className="h-1 flex-1 overflow-hidden rounded-full bg-heat-0">
									<motion.div
										className="h-full rounded-full bg-accent"
										initial={false}
										animate={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
										transition={{ type: "spring", stiffness: 200, damping: 30 }}
									/>
								</div>
							</div>
							<HabitPreview
								habit={preview}
								identityStatement={identityStatement}
								compact
								className="mb-6 lg:hidden"
							/>
							<AnimatePresence
								mode="wait"
								initial={false}
								custom={direction}
								// The old step's focused field is gone: land on the new step's title,
								// or announce it when focus stayed on the footer buttons.
								onExitComplete={() =>
									requestAnimationFrame(() =>
										focusHeading(stepRef.current, { announceOtherwise: true }),
									)
								}
							>
								<motion.section
									key={step}
									initial={{ opacity: 0, x: 12 * direction }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: -12 * direction }}
									transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
								>
									<h2 className="text-balance font-display text-ink text-title md:text-[2.5rem] md:leading-[2.75rem]">
										{stepTitle[step].title}
									</h2>
									{stepTitle[step].hint ? (
										<p className="mt-2 mb-7 max-w-xl text-ink-muted">{stepTitle[step].hint}</p>
									) : (
										<div className="mb-7" />
									)}
									{stepContent[step]}
								</motion.section>
							</AnimatePresence>
						</>
					) : (
						<QuickForm
							draft={draft}
							update={update}
							nameError={nameError}
							habitId={habitId}
							onPickTemplate={pickTemplate}
						/>
					)}
				</main>
				<aside className="hidden lg:block">
					<div className="sticky top-24">
						<HabitPreview habit={preview} identityStatement={identityStatement} />
					</div>
				</aside>
			</div>

			<footer className="sticky bottom-0 z-20 border-line border-t bg-bg/90 pb-safe backdrop-blur-xl">
				<div className="mx-auto flex h-[72px] w-full max-w-[1080px] items-center gap-3 px-5 md:px-8">
					{mode === "guided" ? (
						<>
							<Button
								variant="ghost"
								onClick={() => (index > 0 ? goTo(STEPS[index - 1] ?? "what") : close())}
							>
								<ArrowLeft />
								{index > 0 ? t("common.back") : t("common.cancel")}
							</Button>
							<div className="flex-1" />
							{step === "review" ? (
								<Button size="lg" onClick={save}>
									{editing ? t("form.saveChanges") : t("form.create")}
								</Button>
							) : (
								<>
									{editing ? (
										<Button variant="secondary" onClick={save} className="hidden sm:inline-flex">
											{t("form.saveChanges")}
										</Button>
									) : null}
									<Button size="lg" onClick={next}>
										{t("common.next")}
										<ArrowRight />
									</Button>
								</>
							)}
						</>
					) : (
						<>
							<Button variant="ghost" onClick={close}>
								{t("common.cancel")}
							</Button>
							<div className="flex-1" />
							<Button size="lg" onClick={save}>
								{editing ? t("form.saveChanges") : t("form.create")}
							</Button>
						</>
					)}
				</div>
			</footer>
		</div>
	);
}

interface QuickFormProps {
	draft: HabitDraft;
	update(patch: Partial<HabitDraft>): void;
	nameError: boolean;
	/** Present when editing an existing habit. */
	habitId?: string;
	onPickTemplate(template: HabitTemplate): void;
}

function QuickForm({ draft, update, nameError, habitId, onPickTemplate }: QuickFormProps) {
	const { t } = useT();
	const editing = habitId !== undefined;
	const isBreak = draft.kind === "break";
	return (
		<div className="flex flex-col gap-8">
			<QuickSection>
				<BasicsFields
					draft={draft}
					update={update}
					nameError={nameError}
					autoFocus={!editing}
					editing={editing}
				/>
			</QuickSection>
			<QuickSection title={t("form.identity")}>
				<IdentityFields draft={draft} update={update} />
			</QuickSection>
			<QuickSection title={t("form.advanced")} hint={t("form.advancedHint")}>
				<div className="flex flex-col gap-8">
					<LawBlock law="1" title={t(isBreak ? "form.step.invisible" : "form.step.obvious")}>
						<ObviousFields draft={draft} update={update} habitId={habitId} />
					</LawBlock>
					<LawBlock law="3" title={t(isBreak ? "form.step.difficult" : "form.step.easy")}>
						<EasyFields draft={draft} update={update} habitId={habitId} />
					</LawBlock>
					<LawBlock
						law="2 · 4"
						title={t(isBreak ? "form.step.unsatisfying" : "form.step.satisfying")}
					>
						<SatisfyingFields draft={draft} update={update} habitId={habitId} />
					</LawBlock>
				</div>
			</QuickSection>
			<SetupTasksReview draft={draft} update={update} habitId={habitId} />
			{editing ? null : <TemplateList draft={draft} onPick={onPickTemplate} />}
		</div>
	);
}

function QuickSection({
	title,
	hint,
	children,
}: { title?: string; hint?: string; children: ReactNode }) {
	return (
		<section className="rounded-xl border border-line bg-surface p-5 shadow-card md:p-6">
			{title ? (
				<div className="mb-5">
					<h2 className="font-semibold text-h3 text-ink">{title}</h2>
					{hint ? <p className="mt-0.5 text-ink-muted text-small">{hint}</p> : null}
				</div>
			) : null}
			{children}
		</section>
	);
}

function LawBlock({ law, title, children }: { law: string; title: string; children: ReactNode }) {
	return (
		<div>
			<div className="mb-4 flex items-center gap-2.5">
				<span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-accent-soft px-1.5 font-semibold text-[11px] text-ink tabular-nums dark:text-accent-text">
					{law}
				</span>
				<h3 className="font-medium text-ink">{title}</h3>
			</div>
			{children}
		</div>
	);
}
