import type { sharedEn } from "./shared.en";

export const sharedPtBR: Record<keyof typeof sharedEn, string> = {
	"nav.journal": "Diário",
	"nav.account": "Conta",

	"cue.time": "Um horário",
	"cue.location": "Um lugar",
	"cue.event": "Algo que eu tinha acabado de fazer",
	"cue.emotion": "Um sentimento",
	"cue.people": "Outras pessoas",

	"tracker.unit.pages.one": "{count} página",
	"tracker.unit.pages.other": "{count} páginas",
	"tracker.unit.words.one": "{count} palavra",
	"tracker.unit.words.other": "{count} palavras",
	"tracker.unit.minutes.one": "{count} min",
	"tracker.unit.minutes.other": "{count} min",
	"tracker.unit.sessions.one": "{count} sessão",
	"tracker.unit.sessions.other": "{count} sessões",

	"create.journalEntry": "Entrada no diário",
	"create.journalHint": "Evidência, plano de retomada, revisão…",

	"app.newVersion": "Uma nova versão está pronta",
	"app.reload": "Recarregar",

	"list.and.pair": "{first} e {second}",
	"list.and.last": "{rest} e {last}",
	"list.or.pair": "{first} ou {second}",
	"list.or.last": "{rest} ou {last}",
};
