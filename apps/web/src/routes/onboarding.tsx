import { LogoMark } from "@/components/brand/logo";
import { CompoundChart } from "@/components/insights/compound-chart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useT } from "@/lib/messages";
import { useHabitStyle } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { type HabitTemplate, type IdentityTemplate, identityTemplates } from "@atomic/core";
import { useActions, useLocale, useSettings } from "@atomic/core/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, PenLine, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";

export const Route = createFileRoute("/onboarding")({
	component: OnboardingScreen,
});

const STEPS = ["welcome", "compound", "systems", "name", "identities", "habits", "ready"] as const;
type Step = (typeof STEPS)[number];
const MAX_IDENTITIES = 3;
const MAX_HABITS = 3;

interface CustomIdentity {
	key: string;
	statement: string;
}

function OnboardingScreen() {
	const { t, at } = useT();
	const locale = useLocale();
	const settings = useSettings();
	const actions = useActions();
	const navigate = useNavigate();
	const templates = useMemo(() => identityTemplates(locale), [locale]);

	const [step, setStep] = useState<Step>("welcome");
	const [direction, setDirection] = useState(1);
	const [name, setName] = useState(settings.displayName);
	const [identityKeys, setIdentityKeys] = useState<string[]>([]);
	const [custom, setCustom] = useState<CustomIdentity[]>([]);
	const [habitKeys, setHabitKeys] = useState<string[] | null>(null);

	const selectedTemplates = templates.filter((tpl) => identityKeys.includes(tpl.key));
	const candidateHabits = selectedTemplates.flatMap((tpl) =>
		tpl.habits.map((habit) => ({ habit, identity: tpl })),
	);
	const chosenHabitKeys = habitKeys ?? candidateHabits.slice(0, MAX_HABITS).map((c) => c.habit.key);
	const index = STEPS.indexOf(step);

	const go = (next: Step) => {
		setDirection(STEPS.indexOf(next) > index ? 1 : -1);
		setStep(next);
	};
	const nextStep = () => {
		const next = STEPS[index + 1];
		if (next) go(next);
	};
	const prevStep = () => {
		const prev = STEPS[index - 1];
		if (prev) go(prev);
	};

	const finish = (create: boolean) => {
		if (create) {
			const ids = new Map<string, string>();
			for (const tpl of selectedTemplates) {
				const identity = actions.createIdentity({
					statement: tpl.statement,
					emoji: tpl.emoji,
					color: tpl.color,
				});
				ids.set(tpl.key, identity.id);
			}
			for (const item of custom) {
				if (item.statement.trim()) actions.createIdentity({ statement: item.statement });
			}
			for (const { habit, identity } of candidateHabits) {
				if (!chosenHabitKeys.includes(habit.key)) continue;
				const { key: _key, ...fields } = habit;
				actions.createHabit({ ...fields, identityId: ids.get(identity.key) ?? null });
			}
		}
		actions.updateSettings({
			displayName: create ? name.trim() : settings.displayName,
			onboarded: true,
		});
		void navigate({ to: "/" });
	};

	const explore = () => {
		actions.loadDemoData(locale);
		if (name.trim()) actions.updateSettings({ displayName: name.trim() });
		void navigate({ to: "/" });
	};

	const toggleIdentity = (key: string) => {
		setHabitKeys(null);
		setIdentityKeys((keys) =>
			keys.includes(key)
				? keys.filter((k) => k !== key)
				: keys.length + custom.length >= MAX_IDENTITIES
					? keys
					: [...keys, key],
		);
	};

	return (
		<div className="flex min-h-dvh flex-col">
			<header className="mx-auto flex h-16 w-full max-w-[600px] shrink-0 items-center justify-between px-5">
				<div className="w-20">
					{index > 0 ? (
						<Button variant="ghost" size="sm" onClick={prevStep} className="-ml-2">
							<ArrowLeft />
							{t("common.back")}
						</Button>
					) : null}
				</div>
				<ol
					className="flex items-center gap-1.5"
					aria-label={t("form.step", { current: index + 1, total: STEPS.length })}
				>
					{STEPS.map((s, i) => (
						<li
							key={s}
							aria-current={i === index ? "step" : undefined}
							className={cn(
								"h-1.5 rounded-full transition-all duration-(--atomic-duration-base)",
								i === index
									? "w-6 bg-accent"
									: i < index
										? "w-1.5 bg-ink-muted"
										: "w-1.5 bg-line-strong",
							)}
						/>
					))}
				</ol>
				<div className="flex w-20 justify-end">
					{step !== "ready" ? (
						<Button variant="ghost" size="sm" className="-mr-2" onClick={() => finish(false)}>
							{t("common.skip")}
						</Button>
					) : null}
				</div>
			</header>

			<main className="mx-auto flex w-full max-w-[600px] flex-1 flex-col px-5 pb-8">
				<AnimatePresence mode="wait" custom={direction} initial={false}>
					<motion.div
						key={step}
						custom={direction}
						initial={{ opacity: 0, x: 16 * direction }}
						animate={{ opacity: 1, x: 0 }}
						exit={{ opacity: 0, x: -16 * direction }}
						transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
						className="flex flex-1 flex-col"
					>
						{step === "welcome" ? (
							<StepLayout
								center
								footer={
									<>
										<Button size="lg" className="w-full sm:w-auto sm:min-w-48" onClick={nextStep}>
											{t("onboarding.begin")}
										</Button>
										<Button
											variant="ghost"
											size="lg"
											className="w-full sm:w-auto"
											onClick={explore}
										>
											{t("onboarding.explore")}
										</Button>
									</>
								}
							>
								<LogoMark className="mb-8 size-16" />
								<h1 className="text-balance font-display text-[2.75rem] text-ink leading-[1.05] md:text-[3.5rem]">
									{t("onboarding.welcomeTitle")}
								</h1>
								<p className="mt-4 max-w-md text-balance text-ink-muted text-lg">
									{t("onboarding.welcomeBody")}
								</p>
							</StepLayout>
						) : null}

						{step === "compound" ? (
							<StepLayout footer={<ContinueButton onClick={nextStep} />}>
								<StepTitle>{t("onboarding.compoundTitle")}</StepTitle>
								<div className="my-6 rounded-xl border border-line bg-surface p-4 shadow-card">
									<CompoundChart days={365} />
								</div>
								<p className="text-ink-muted">{t("onboarding.compoundBody")}</p>
							</StepLayout>
						) : null}

						{step === "systems" ? (
							<StepLayout center footer={<ContinueButton onClick={nextStep} />}>
								<h1 className="section-label mb-8">{t("onboarding.systemsTitle")}</h1>
								<blockquote className="text-balance font-display text-[2.25rem] text-ink italic leading-[1.15] md:text-[2.75rem]">
									“{t("onboarding.systemsQuote")}”
								</blockquote>
								<p className="mt-4 text-ink-subtle">— {at("onboarding.quoteAuthor")}</p>
								<p className="mt-8 max-w-md text-balance text-ink-muted">
									{t("onboarding.systemsBody")}
								</p>
							</StepLayout>
						) : null}

						{step === "name" ? (
							<StepLayout
								footer={<ContinueButton onClick={nextStep} />}
								onSubmit={(event) => {
									event.preventDefault();
									nextStep();
								}}
							>
								<StepTitle>{t("onboarding.nameTitle")}</StepTitle>
								<Input
									value={name}
									onChange={(event) => setName(event.target.value)}
									placeholder={t("onboarding.namePlaceholder")}
									aria-label={t("onboarding.namePlaceholder")}
									maxLength={60}
									autoFocus
									className="mt-6 h-14 text-h3"
								/>
							</StepLayout>
						) : null}

						{step === "identities" ? (
							<StepLayout
								footer={
									<ContinueButton
										onClick={nextStep}
										disabled={!identityKeys.length && !custom.some((c) => c.statement.trim())}
									/>
								}
							>
								<StepTitle>{t("onboarding.identityTitle")}</StepTitle>
								<p className="mt-2 text-ink-muted">{t("onboarding.identityBody")}</p>
								<p className="section-label mt-4">
									{at("onboarding.pickUpTo", { count: MAX_IDENTITIES })}
								</p>
								<div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
									{templates.map((tpl) => (
										<IdentityOption
											key={tpl.key}
											template={tpl}
											selected={identityKeys.includes(tpl.key)}
											disabled={
												!identityKeys.includes(tpl.key) &&
												identityKeys.length + custom.length >= MAX_IDENTITIES
											}
											onToggle={() => toggleIdentity(tpl.key)}
										/>
									))}
								</div>
								<CustomIdentities
									items={custom}
									onChange={setCustom}
									canAdd={identityKeys.length + custom.length < MAX_IDENTITIES}
								/>
							</StepLayout>
						) : null}

						{step === "habits" ? (
							<StepLayout footer={<ContinueButton onClick={nextStep} />}>
								<StepTitle>{t("onboarding.habitsTitle")}</StepTitle>
								<p className="mt-2 text-ink-muted">{t("onboarding.habitsBody")}</p>
								{candidateHabits.length ? (
									<>
										<p className="section-label mt-4">
											{at("onboarding.pickUpTo", { count: MAX_HABITS })}
										</p>
										<div className="mt-3 flex flex-col gap-2.5">
											{candidateHabits.map(({ habit }) => {
												const selected = chosenHabitKeys.includes(habit.key);
												return (
													<HabitOption
														key={habit.key}
														habit={habit}
														selected={selected}
														disabled={!selected && chosenHabitKeys.length >= MAX_HABITS}
														onToggle={() =>
															setHabitKeys(
																selected
																	? chosenHabitKeys.filter((k) => k !== habit.key)
																	: [...chosenHabitKeys, habit.key],
															)
														}
													/>
												);
											})}
										</div>
									</>
								) : null}
							</StepLayout>
						) : null}

						{step === "ready" ? (
							<StepLayout
								center
								footer={
									<Button
										size="lg"
										className="w-full sm:w-auto sm:min-w-48"
										onClick={() => finish(true)}
									>
										{t("onboarding.start")}
									</Button>
								}
							>
								<div className="mb-8 grid size-20 place-items-center rounded-full bg-accent-soft">
									<LogoMark className="size-12" />
								</div>
								<StepTitle>{t("onboarding.readyTitle")}</StepTitle>
								<p className="mt-3 text-ink-muted text-lg">{t("onboarding.readyBody")}</p>
								<div className="mt-8 flex flex-wrap justify-center gap-2">
									{candidateHabits
										.filter(({ habit }) => chosenHabitKeys.includes(habit.key))
										.map(({ habit }) => (
											<span
												key={habit.key}
												className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-ink text-small shadow-card"
											>
												<span className="font-emoji">{habit.emoji}</span>
												{habit.name}
											</span>
										))}
								</div>
							</StepLayout>
						) : null}
					</motion.div>
				</AnimatePresence>
			</main>
		</div>
	);
}

interface StepLayoutProps {
	children: ReactNode;
	footer: ReactNode;
	center?: boolean;
	onSubmit?(event: FormEvent): void;
}

function StepLayout({ children, footer, center, onSubmit }: StepLayoutProps) {
	const Wrapper = onSubmit ? "form" : "div";
	return (
		<Wrapper onSubmit={onSubmit} className="flex flex-1 flex-col">
			<div
				className={cn(
					"flex flex-1 flex-col py-6 md:justify-center md:py-10",
					center && "items-center justify-center text-center",
				)}
			>
				{children}
			</div>
			<div
				className={cn(
					"flex flex-col gap-2 pt-4 sm:flex-row",
					center ? "sm:justify-center" : "sm:justify-end",
				)}
			>
				{footer}
			</div>
		</Wrapper>
	);
}

function StepTitle({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<h1
			className={cn(
				"text-balance font-display text-[2.25rem] text-ink leading-tight md:text-[2.75rem]",
				className,
			)}
		>
			{children}
		</h1>
	);
}

function ContinueButton({ onClick, disabled }: { onClick(): void; disabled?: boolean }) {
	const { t } = useT();
	return (
		<Button
			size="lg"
			className="w-full sm:w-auto sm:min-w-40"
			onClick={onClick}
			disabled={disabled}
			type="button"
		>
			{t("common.continue")}
		</Button>
	);
}

function SelectCheck({ selected }: { selected: boolean }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"grid size-6 shrink-0 place-items-center rounded-full border-[1.5px] transition-colors",
				selected ? "border-accent bg-accent text-on-accent" : "border-line-strong",
			)}
		>
			{selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
		</span>
	);
}

function IdentityOption({
	template,
	selected,
	disabled,
	onToggle,
}: {
	template: IdentityTemplate;
	selected: boolean;
	disabled: boolean;
	onToggle(): void;
}) {
	const style = useHabitStyle(template.color);
	return (
		<button
			type="button"
			aria-pressed={selected}
			disabled={disabled}
			onClick={onToggle}
			style={style}
			className={cn(
				"flex items-center gap-3 rounded-lg border bg-surface p-3.5 text-left transition-[border-color,box-shadow,opacity] duration-(--atomic-duration-fast) disabled:opacity-45",
				selected
					? "border-accent shadow-[0_0_0_1px_var(--accent)]"
					: "border-line hover:border-line-strong",
			)}
		>
			<span className="grid size-10 shrink-0 place-items-center rounded-md bg-(--habit-soft) font-emoji text-xl">
				{template.emoji}
			</span>
			<span className="min-w-0 flex-1 font-medium text-ink text-small leading-snug">
				{template.statement}
			</span>
			<SelectCheck selected={selected} />
		</button>
	);
}

function HabitOption({
	habit,
	selected,
	disabled,
	onToggle,
}: {
	habit: HabitTemplate;
	selected: boolean;
	disabled: boolean;
	onToggle(): void;
}) {
	const style = useHabitStyle(habit.color);
	return (
		<button
			type="button"
			aria-pressed={selected}
			disabled={disabled}
			onClick={onToggle}
			style={style}
			className={cn(
				"flex items-center gap-3.5 rounded-lg border bg-surface p-3.5 text-left transition-[border-color,box-shadow,opacity] duration-(--atomic-duration-fast) disabled:opacity-45",
				selected
					? "border-accent shadow-[0_0_0_1px_var(--accent)]"
					: "border-line hover:border-line-strong",
			)}
		>
			<span className="grid size-11 shrink-0 place-items-center rounded-full bg-(--habit-soft) font-emoji text-xl">
				{habit.emoji}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block font-medium text-ink">{habit.name}</span>
				{habit.twoMinute ? (
					<span className="block truncate text-ink-muted text-small italic">{habit.twoMinute}</span>
				) : null}
			</span>
			<SelectCheck selected={selected} />
		</button>
	);
}

function CustomIdentities({
	items,
	onChange,
	canAdd,
}: {
	items: CustomIdentity[];
	onChange(items: CustomIdentity[]): void;
	canAdd: boolean;
}) {
	const { t } = useT();
	return (
		<div className="mt-3 flex flex-col gap-2.5">
			{items.map((item) => (
				<div key={item.key} className="flex items-center gap-2">
					<Input
						value={item.statement}
						autoFocus
						maxLength={120}
						placeholder={t("identity.placeholder")}
						aria-label={t("onboarding.customIdentity")}
						onChange={(event) =>
							onChange(
								items.map((i) =>
									i.key === item.key ? { ...i, statement: event.target.value } : i,
								),
							)
						}
					/>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => onChange(items.filter((i) => i.key !== item.key))}
					>
						{t("common.delete")}
					</Button>
				</div>
			))}
			{canAdd ? (
				<button
					type="button"
					onClick={() => onChange([...items, { key: String(Date.now()), statement: "" }])}
					className="flex items-center gap-3 rounded-lg border border-line-strong border-dashed p-3.5 text-left text-ink-muted transition-colors hover:border-ink-subtle hover:text-ink"
				>
					<span className="grid size-10 place-items-center rounded-md bg-sunken">
						{items.length ? <Plus className="size-4" /> : <PenLine className="size-4" />}
					</span>
					<span className="font-medium text-small">{t("onboarding.customIdentity")}</span>
				</button>
			) : null}
		</div>
	);
}
