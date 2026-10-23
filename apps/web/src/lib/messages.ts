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
	"color.ember": "Ember",
	"color.amber": "Amber",
	"color.lime": "Lime",
	"color.emerald": "Emerald",
	"color.teal": "Teal",
	"color.sky": "Sky",
	"color.indigo": "Indigo",
	"color.violet": "Violet",
	"color.rose": "Rose",
	"color.stone": "Stone",
	"form.customEmoji": "Or type any emoji",
	"form.clearTime": "Clear time",
	"form.preview": "Preview",
	"form.previewEmpty": "Your habit",
	"form.emojiPick": "Choose an icon",
	"form.daysLabel": "Days",
	"form.timesLabel": "Times per week",
	"form.templatesShow": "Browse templates",
	"habits.last7": "Last 7 days",
	"habit.logged": "{habit} done",
	"habit.vote": "+{count}",
	"habit.completeHint": "Done for today. Extra reps? Use “Log an extra rep” in the menu.",
	"identity.thisWeek": "+{count} this week",
	"identity.atoms": "Each dot is a vote",
	"identity.atomsScaled": "Each dot is {count} votes",
	"identity.edit": "Edit identity",
	"insights.dailyTitle": "Daily completion",
	"insights.dailyHint": "Share of due habits completed each day.",
	"insights.journey": "Day {count}",
	"insights.strongestHint": "Strength grows with consistency and fades slowly when you miss.",
	"insights.compoundHypothetical":
		"Over {days}, improving 1% a day compounds to {better}×. Staying the same keeps you at 1×. Slipping 1% a day shrinks you to {worse}×.",
	"sync.synced": "Synced",
	"sync.error": "Sync paused",
	"settings.fourLaws": "The four laws of behavior change",
	"settings.fourLawsIntro":
		"Every habit runs on cue, craving, response and reward. Use the four laws to build good habits, and invert them to break bad ones.",
	"scorecard.rating": "Rating",
	"settings.exported": "Backup downloaded",
	"settings.exportUnavailable": "Saving files isn't available here.",
	"settings.syncSignedOut": "Sign in to back up and sync across devices.",
	"settings.syncFormHint": "Use the email and password for your Atomic server account.",
	"shortcuts.then": "then",
	"shortcuts.close": "Close dialog",
	"onboarding.pickUpTo": "Choose up to {count}",
	"onboarding.quoteAuthor": "James Clear",
	"onboarding.selected": "Selected",
	"you.subtitle": "Identity, insights and settings",
	"palette.logHabit": "Log {habit}",
	"palette.results": "Results",
	"toast.region": "Notifications",
	"page.title": "{page} · {app}",
	"common.moreFor": "More actions for {name}",
	"today.viewArchived": "View archived habits",
	"form.kindLocked": "The type can't be changed once a habit exists.",
	"habit.decrementFor": "Remove one from {habit}",
	"habit.undoneAnnounce": "{habit} marked not done",
	"habit.unslipAnnounce": "{habit}: slip removed",
	"habit.resetDone": "{habit}: day reset",
	"scorecard.ratingFor": "Rating for {label}",
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
	"color.ember": "Brasa",
	"color.amber": "Âmbar",
	"color.lime": "Lima",
	"color.emerald": "Esmeralda",
	"color.teal": "Turquesa",
	"color.sky": "Céu",
	"color.indigo": "Índigo",
	"color.violet": "Violeta",
	"color.rose": "Rosa",
	"color.stone": "Pedra",
	"form.customEmoji": "Ou digite qualquer emoji",
	"form.clearTime": "Limpar horário",
	"form.preview": "Prévia",
	"form.previewEmpty": "Seu hábito",
	"form.emojiPick": "Escolha um ícone",
	"form.daysLabel": "Dias",
	"form.timesLabel": "Vezes por semana",
	"form.templatesShow": "Ver modelos",
	"habits.last7": "Últimos 7 dias",
	"habit.logged": "{habit} feito",
	"habit.vote": "+{count}",
	"habit.completeHint":
		"Feito por hoje. Repetições extras? Use “Registrar repetição extra” no menu.",
	"identity.thisWeek": "+{count} esta semana",
	"identity.atoms": "Cada ponto é um voto",
	"identity.atomsScaled": "Cada ponto vale {count} votos",
	"identity.edit": "Editar identidade",
	"insights.dailyTitle": "Conclusão diária",
	"insights.dailyHint": "Parcela dos hábitos previstos concluídos a cada dia.",
	"insights.journey": "Dia {count}",
	"insights.strongestHint":
		"A força cresce com a consistência e diminui devagar quando você falha.",
	"insights.compoundHypothetical":
		"Em {days}, melhorar 1% ao dia acumula {better}×. Ficar igual mantém você em 1×. Piorar 1% ao dia encolhe para {worse}×.",
	"sync.synced": "Sincronizado",
	"sync.error": "Sincronização pausada",
	"settings.fourLaws": "As quatro leis da mudança de comportamento",
	"settings.fourLawsIntro":
		"Todo hábito segue deixa, desejo, resposta e recompensa. Use as quatro leis para construir bons hábitos e inverta-as para abandonar os ruins.",
	"scorecard.rating": "Avaliação",
	"settings.exported": "Backup baixado",
	"settings.exportUnavailable": "Não é possível salvar arquivos aqui.",
	"settings.syncSignedOut": "Entre para fazer backup e sincronizar entre dispositivos.",
	"settings.syncFormHint": "Use o e-mail e a senha da sua conta no servidor Atomic.",
	"shortcuts.then": "depois",
	"shortcuts.close": "Fechar janela",
	"onboarding.pickUpTo": "Escolha até {count}",
	"onboarding.quoteAuthor": "James Clear",
	"onboarding.selected": "Selecionado",
	"you.subtitle": "Identidade, análises e ajustes",
	"palette.logHabit": "Registrar {habit}",
	"palette.results": "Resultados",
	"toast.region": "Notificações",
	"page.title": "{page} · {app}",
	"common.moreFor": "Mais ações para {name}",
	"today.viewArchived": "Ver hábitos arquivados",
	"form.kindLocked": "O tipo não pode ser alterado depois que o hábito é criado.",
	"habit.decrementFor": "Remover um de {habit}",
	"habit.undoneAnnounce": "{habit} desmarcado",
	"habit.unslipAnnounce": "{habit}: recaída removida",
	"habit.resetDone": "{habit}: dia zerado",
	"scorecard.ratingFor": "Avaliação de {label}",
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

/**
 * `t` is both the translate function and the full translator, so it can be
 * called (`t("nav.today")`), used for formatting (`t.formatDayLong(day)`) and
 * handed to core helpers that expect a `Translator` (`progressLabel(h, n, t)`).
 */
export type CallableTranslator = AppTranslator & ((key: MessageKey, params?: Params) => string);

export interface AppI18n extends AppTranslator {
	t: CallableTranslator;
}

/** `useI18n()` plus typed access to the web-only strings. */
export function useT(): AppI18n {
	const i18n = useI18n();
	return useMemo(() => {
		const base: AppTranslator = {
			...i18n,
			at: (key, params) => i18n.t(key as unknown as MessageKey, params),
		};
		const t = Object.assign(
			(key: MessageKey, params?: Params) => i18n.t(key, params),
			base,
		) as CallableTranslator;
		return { ...base, t };
	}, [i18n]);
}
