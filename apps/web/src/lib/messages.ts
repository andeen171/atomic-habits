import type { Locale, MessageKey, Params, Translator } from "@atomic/core";
import { useI18n } from "@atomic/core/react";
import { useMemo } from "react";

/**
 * Web-only strings, merged over the shared catalog via
 * `<AtomicProvider messages>`. Shared copy lives in `@atomic/core`; only
 * strings specific to this client belong here.
 */
const en = {
	"app.skipToContent": "Skip to content",
	"app.mainNav": "Main navigation",
	"create.title": "Create",
	"create.habitHint": "Build a good habit or break a bad one",
	"create.taskHint": "Capture something you need to do",
	"week.previous": "Previous week",
	"week.next": "Next week",
	"month.previous": "Previous month",
	"month.next": "Next month",
	"form.preview": "Preview",
	"form.previewEmpty": "Your habit",
	"form.emojiPick": "Choose an icon",
	"form.daysLabel": "Days",
	"form.timesLabel": "Times per week",
	"form.templatesShow": "Browse templates",
	"habits.last7": "Last 7 days",
	"habit.logged": "{habit} done",
	"habit.vote": "+{count}",
	"habit.completeHint": "Already done for today",
	"identity.thisWeek": "+{count} this week",
	"identity.atoms": "Each dot is a vote",
	"insights.dailyTitle": "Daily completion",
	"insights.dailyHint": "Share of due habits completed each day.",
	"insights.journey": "Day {count}",
	"insights.strongestHint": "Strength grows with consistency and fades slowly when you miss.",
	"sync.synced": "Synced",
	"sync.error": "Sync paused",
	"settings.fourLaws": "The four laws of behavior change",
	"settings.exported": "Backup downloaded",
	"settings.syncSignedOut": "Sign in to back up and sync across devices.",
	"settings.syncFormHint": "Use the email and password for your Atomic server account.",
	"shortcuts.then": "then",
	"shortcuts.close": "Close dialog",
	"onboarding.pickUpTo": "Choose up to {count}",
	"onboarding.selected": "Selected",
	"you.subtitle": "Identity, insights and settings",
	"palette.logHabit": "Log {habit}",
	"task.markDone": "Mark task as done",
	"task.markUndone": "Mark task as not done",
	"calendar.label": "{date}: {state}",
	"state.done": "Done",
	"state.partial": "In progress",
	"state.missed": "Missed",
	"state.skipped": "Skipped",
	"state.pending": "Not done yet",
	"state.rest": "Rest day",
	"state.future": "Upcoming",
	"state.inactive": "Not started",
	"state.clean": "Clean",
	"state.slipped": "Slipped",
} as const;

export type AppMessageKey = keyof typeof en;

const ptBR: Record<AppMessageKey, string> = {
	"app.skipToContent": "Pular para o conteúdo",
	"app.mainNav": "Navegação principal",
	"create.title": "Criar",
	"create.habitHint": "Construa um bom hábito ou abandone um ruim",
	"create.taskHint": "Anote algo que você precisa fazer",
	"week.previous": "Semana anterior",
	"week.next": "Próxima semana",
	"month.previous": "Mês anterior",
	"month.next": "Próximo mês",
	"form.preview": "Prévia",
	"form.previewEmpty": "Seu hábito",
	"form.emojiPick": "Escolha um ícone",
	"form.daysLabel": "Dias",
	"form.timesLabel": "Vezes por semana",
	"form.templatesShow": "Ver modelos",
	"habits.last7": "Últimos 7 dias",
	"habit.logged": "{habit} feito",
	"habit.vote": "+{count}",
	"habit.completeHint": "Já concluído hoje",
	"identity.thisWeek": "+{count} esta semana",
	"identity.atoms": "Cada ponto é um voto",
	"insights.dailyTitle": "Conclusão diária",
	"insights.dailyHint": "Parcela dos hábitos previstos concluídos a cada dia.",
	"insights.journey": "Dia {count}",
	"insights.strongestHint": "A força cresce com a consistência e diminui devagar quando você falha.",
	"sync.synced": "Sincronizado",
	"sync.error": "Sincronização pausada",
	"settings.fourLaws": "As quatro leis da mudança de comportamento",
	"settings.exported": "Backup baixado",
	"settings.syncSignedOut": "Entre para fazer backup e sincronizar entre dispositivos.",
	"settings.syncFormHint": "Use o e-mail e a senha da sua conta no servidor Atomic.",
	"shortcuts.then": "depois",
	"shortcuts.close": "Fechar janela",
	"onboarding.pickUpTo": "Escolha até {count}",
	"onboarding.selected": "Selecionado",
	"you.subtitle": "Identidade, análises e ajustes",
	"palette.logHabit": "Registrar {habit}",
	"task.markDone": "Marcar tarefa como feita",
	"task.markUndone": "Marcar tarefa como não feita",
	"calendar.label": "{date}: {state}",
	"state.done": "Feito",
	"state.partial": "Em andamento",
	"state.missed": "Perdido",
	"state.skipped": "Pulado",
	"state.pending": "Ainda não feito",
	"state.rest": "Dia de descanso",
	"state.future": "Em breve",
	"state.inactive": "Não iniciado",
	"state.clean": "Limpo",
	"state.slipped": "Recaída",
};

export const appMessages: Partial<Record<Locale, Record<string, string>>> = {
	en,
	"pt-BR": ptBR,
};

export interface AppTranslator extends Translator {
	/** Translate a web-only key from this file. */
	at(key: AppMessageKey, params?: Params): string;
}

/** `useI18n()` plus typed access to the web-only strings. */
export function useT(): AppTranslator {
	const i18n = useI18n();
	return useMemo(
		() => ({ ...i18n, at: (key, params) => i18n.t(key as unknown as MessageKey, params) }),
		[i18n],
	);
}
