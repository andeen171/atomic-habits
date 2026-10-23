import { AccountSection } from "@/components/account/account-section";
import { AiSettingsSection } from "@/components/account/ai-settings-section";
import { TypingSettingsRows } from "@/components/account/typing-settings-rows";
import { LogoMark } from "@/components/brand/logo";
import { ShortcutList } from "@/components/dialogs/shortcuts-dialog";
import { Page, PageHeader } from "@/components/layout/page";
import { DataSection } from "@/components/settings/data-section";
import { ReflectionPromptsRow } from "@/components/settings/reflection-prompts-row";
import { SettingsRow, SettingsSection } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { SegmentedControl } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/lib/messages";
import { isArtifactBuild } from "@/lib/runtime";
import { useUI } from "@/lib/ui";
import type { LocaleSetting, ThemeSetting } from "@atomic/core";
import { useActions, useSettings } from "@atomic/core/react";
import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_app/settings")({
	component: SettingsScreen,
});

function SettingsScreen() {
	const { t } = useT();
	return (
		<Page>
			<PageHeader title={t("settings.title")} />
			<div className="flex flex-col gap-8">
				<ProfileSection />
				<AppearanceSection />
				<PreferencesSection />
				{/* No accounts or AI in the artifact build (spec §1.3). */}
				{isArtifactBuild ? null : <AccountSection />}
				{isArtifactBuild ? null : <AiSettingsSection />}
				<DataSection />
				<SettingsSection title={t("settings.shortcuts")}>
					<div className="px-5 py-2">
						<ShortcutList />
					</div>
				</SettingsSection>
				<AboutSection />
			</div>
		</Page>
	);
}

function ProfileSection() {
	const { t } = useT();
	const settings = useSettings();
	const actions = useActions();
	const [name, setName] = useState(settings.displayName);
	useEffect(() => setName(settings.displayName), [settings.displayName]);
	return (
		<SettingsSection title={t("settings.profile")}>
			<SettingsRow label={t("settings.name")} htmlFor="settings-name" stack>
				<Input
					id="settings-name"
					value={name}
					maxLength={60}
					placeholder={t("settings.namePlaceholder")}
					onChange={(event) => setName(event.target.value)}
					onBlur={() => actions.updateSettings({ displayName: name.trim() })}
					onKeyDown={(event) => {
						if (event.key === "Enter") actions.updateSettings({ displayName: name.trim() });
					}}
					className="sm:w-72"
				/>
			</SettingsRow>
		</SettingsSection>
	);
}

function AppearanceSection() {
	const { t } = useT();
	const settings = useSettings();
	const actions = useActions();
	return (
		<SettingsSection title={t("settings.appearance")}>
			<SettingsRow label={t("settings.theme")} stack>
				<SegmentedControl<ThemeSetting>
					label={t("settings.theme")}
					value={settings.theme}
					onChange={(theme) => actions.updateSettings({ theme })}
					options={[
						{ value: "system", label: t("settings.theme.system"), icon: <Monitor /> },
						{ value: "light", label: t("settings.theme.light"), icon: <Sun /> },
						{ value: "dark", label: t("settings.theme.dark"), icon: <Moon /> },
					]}
				/>
			</SettingsRow>
			<SettingsRow label={t("settings.language")} stack>
				<SegmentedControl<LocaleSetting>
					label={t("settings.language")}
					value={settings.locale}
					onChange={(locale) => actions.updateSettings({ locale })}
					options={[
						{ value: "system", label: t("settings.language.system") },
						{ value: "en", label: t("settings.language.en") },
						{ value: "pt-BR", label: t("settings.language.pt-BR") },
					]}
				/>
			</SettingsRow>
		</SettingsSection>
	);
}

function PreferencesSection() {
	const { t } = useT();
	const settings = useSettings();
	const actions = useActions();
	return (
		<SettingsSection title={t("settings.preferences")}>
			<SettingsRow label={t("settings.weekStartsOn")} stack>
				<SegmentedControl<0 | 1>
					label={t("settings.weekStartsOn")}
					value={settings.weekStartsOn}
					onChange={(weekStartsOn) => actions.updateSettings({ weekStartsOn })}
					options={[
						{
							value: 1,
							label: (
								<span className="inline-block first-letter:uppercase">{t.weekdayName(1)}</span>
							),
						},
						{
							value: 0,
							label: (
								<span className="inline-block first-letter:uppercase">{t.weekdayName(0)}</span>
							),
						},
					]}
				/>
			</SettingsRow>
			<SettingsRow
				label={t("settings.celebrations")}
				hint={t("settings.celebrationsHint")}
				htmlFor="settings-celebrations"
			>
				<Switch
					id="settings-celebrations"
					checked={settings.celebrations}
					onCheckedChange={(celebrations) => actions.updateSettings({ celebrations })}
				/>
			</SettingsRow>
			<ReflectionPromptsRow />
			<TypingSettingsRows />
		</SettingsSection>
	);
}

function AboutSection() {
	const { t, at } = useT();
	const setFourLawsOpen = useUI((s) => s.setFourLawsOpen);
	return (
		<SettingsSection title={t("settings.about")}>
			<div className="px-5 py-5">
				<div className="flex items-start gap-4">
					<LogoMark className="size-10 shrink-0" />
					<div className="min-w-0">
						<p className="font-display text-h2 text-ink">{t("app.name")}</p>
						<p className="text-ink-muted text-small">{t("app.tagline")}</p>
						<p className="mt-1 text-ink-subtle text-small">
							{t("settings.version", { version: __APP_VERSION__ })}
						</p>
						<p className="mt-3 text-ink-subtle text-small">{t("app.attribution")}</p>
					</div>
				</div>
				{/* Phones: full width and allowed to wrap (the pt-BR label is long). */}
				<Button
					variant="secondary"
					size="sm"
					className="mt-4 h-auto min-h-11 w-full whitespace-normal rounded-lg py-2 text-left leading-snug sm:ml-14 sm:min-h-8 sm:w-auto sm:max-w-[calc(100%-3.5rem)] sm:rounded-full sm:py-1.5"
					onClick={() => setFourLawsOpen(true)}
				>
					<BookOpen />
					<span className="min-w-0 break-words">{at("settings.fourLaws")}</span>
				</Button>
			</div>
		</SettingsSection>
	);
}
