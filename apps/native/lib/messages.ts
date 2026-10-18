/**
 * Strings that only the native app needs. Everything else comes from the
 * shared catalog in `@atomic/core` — prefer those keys whenever they fit.
 */
const en = {
	"create.newTask": "New task",
	"create.habitHint": "Build a good habit or break a bad one",
	"create.taskHint": "Capture something you need to do",
	"create.a11y": "Create a habit or task",

	"a11y.prevWeek": "Previous week",
	"a11y.nextWeek": "Next week",
	"a11y.prevMonth": "Previous month",
	"a11y.nextMonth": "Next month",
	"a11y.habitActions": "More actions for {habit}",
	"a11y.dayScore": "{date}: {percent} complete",
	"a11y.completeTask": "Complete {task}",
	"a11y.reopenTask": "Mark {task} as not done",
	"a11y.priority": "{priority} priority",
	"a11y.votes": "{votes} votes",

	"today.tapHint": "Tap a ring to log it. Hold for more.",
	"today.weekA11y": "Week of {date}",

	"habit.setCount": "Set progress",
	"habit.setCountHint": "Repetitions logged for {date}.",
	"habit.restDay": "Rest day",
	"habit.alreadyDone": "Already done — nice work.",

	"detail.logToday": "Log today",
	"detail.doneToday": "Done today",
	"detail.cleanToday": "Clean today",
	"detail.at": "at {time}",
	"detail.archivedBanner": "This habit is archived. Its history is kept.",
	"detail.stats": "Stats",

	"editor.preview": "Preview",
	"editor.pickTime": "Pick a time",
	"editor.noTime": "No time",
	"editor.hour": "Hour",
	"editor.minute": "Minute",
	"editor.clear": "Clear",
	"editor.onDays": "On these days",
	"editor.perWeek": "Times per week",
	"editor.identityNewHint": "Describe who you're becoming.",
	"editor.whenWhere": "When and where",
	"editor.goal": "Goal",
	"editor.details": "Details",
	"editor.created": "{habit} added. Start with two minutes.",

	"tasks.showCompleted": "Show completed",
	"tasks.hideCompleted": "Hide completed",
	"tasks.reopened": "Task reopened",
	"tasks.saveHint": "Changes save as you type.",
	"tasks.cleared": "Completed tasks cleared ({count})",

	"you.subtitle": "Every action is a vote for who you're becoming.",
	"you.greeting": "Hi, {name}",
	"you.thisWeek": "+{count} this week",
	"you.settingsHint": "Profile, appearance, sync and data",
	"you.identitiesTitle": "Your identities",
	"you.noIdentities": "No identities yet. Decide who you want to become.",
	"you.explore": "Explore",

	"insights.dailyTitle": "Daily completion",
	"insights.dailyHint": "Share of due habits completed each day.",
	"insights.dayN": "Day {count}",
	"insights.strongestHint": "Habit strength — how automatic each habit is becoming.",

	"settings.exported": "Backup ready to share",
	"settings.syncUpToDate": "Up to date",
	"settings.syncSetup": "Set up sync",
	"settings.privacy": "Your data never leaves this device unless you turn on sync.",
	"settings.remindersEnable": "Allow notifications",

	"onboarding.attribution": "— James Clear",
	"onboarding.pickUpTo": "Pick up to 3",
	"onboarding.stepA11y": "Step {current} of {total}",
} as const;

export type AppMessageKey = keyof typeof en;

const ptBR: Record<AppMessageKey, string> = {
	"create.newTask": "Nova tarefa",
	"create.habitHint": "Construa um bom hábito ou largue um ruim",
	"create.taskHint": "Anote algo que você precisa fazer",
	"create.a11y": "Criar um hábito ou uma tarefa",

	"a11y.prevWeek": "Semana anterior",
	"a11y.nextWeek": "Próxima semana",
	"a11y.prevMonth": "Mês anterior",
	"a11y.nextMonth": "Próximo mês",
	"a11y.habitActions": "Mais ações para {habit}",
	"a11y.dayScore": "{date}: {percent} concluído",
	"a11y.completeTask": "Concluir {task}",
	"a11y.reopenTask": "Marcar {task} como não concluída",
	"a11y.priority": "Prioridade {priority}",
	"a11y.votes": "{votes} votos",

	"today.tapHint": "Toque no anel para registrar. Segure para mais opções.",
	"today.weekA11y": "Semana de {date}",

	"habit.setCount": "Definir progresso",
	"habit.setCountHint": "Repetições registradas em {date}.",
	"habit.restDay": "Dia de descanso",
	"habit.alreadyDone": "Já feito — bom trabalho.",

	"detail.logToday": "Registrar hoje",
	"detail.doneToday": "Feito hoje",
	"detail.cleanToday": "Limpo hoje",
	"detail.at": "às {time}",
	"detail.archivedBanner": "Este hábito está arquivado. O histórico foi mantido.",
	"detail.stats": "Estatísticas",

	"editor.preview": "Prévia",
	"editor.pickTime": "Escolha um horário",
	"editor.noTime": "Sem horário",
	"editor.hour": "Hora",
	"editor.minute": "Minuto",
	"editor.clear": "Limpar",
	"editor.onDays": "Nestes dias",
	"editor.perWeek": "Vezes por semana",
	"editor.identityNewHint": "Descreva quem você está se tornando.",
	"editor.whenWhere": "Quando e onde",
	"editor.goal": "Meta",
	"editor.details": "Detalhes",
	"editor.created": "{habit} adicionado. Comece com dois minutos.",

	"tasks.showCompleted": "Mostrar concluídas",
	"tasks.hideCompleted": "Ocultar concluídas",
	"tasks.reopened": "Tarefa reaberta",
	"tasks.saveHint": "As alterações são salvas enquanto você digita.",
	"tasks.cleared": "Tarefas concluídas removidas ({count})",

	"you.subtitle": "Cada ação é um voto em quem você está se tornando.",
	"you.greeting": "Olá, {name}",
	"you.thisWeek": "+{count} esta semana",
	"you.settingsHint": "Perfil, aparência, sincronização e dados",
	"you.identitiesTitle": "Suas identidades",
	"you.noIdentities": "Nenhuma identidade ainda. Decida quem você quer se tornar.",
	"you.explore": "Explorar",

	"insights.dailyTitle": "Conclusão diária",
	"insights.dailyHint": "Parte dos hábitos do dia concluídos em cada dia.",
	"insights.dayN": "Dia {count}",
	"insights.strongestHint": "Força do hábito — o quanto cada hábito está ficando automático.",

	"settings.exported": "Backup pronto para compartilhar",
	"settings.syncUpToDate": "Sincronizado",
	"settings.syncSetup": "Configurar sincronização",
	"settings.privacy":
		"Seus dados nunca saem deste aparelho, a menos que você ative a sincronização.",
	"settings.remindersEnable": "Permitir notificações",

	"onboarding.attribution": "— James Clear",
	"onboarding.pickUpTo": "Escolha até 3",
	"onboarding.stepA11y": "Etapa {current} de {total}",
};

/** Passed to `<AtomicProvider messages>`; merged over the shared catalog. */
export const appMessages = { en, "pt-BR": ptBR };
