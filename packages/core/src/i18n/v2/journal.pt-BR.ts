import type { journalEn } from "./journal.en";

export const journalPtBR: Record<keyof typeof journalEn, string> = {
	// ── Ajustes, atalhos, lembrete de revisão ──
	"settings.reviewCadence": "Convites para reflexão",
	"settings.reviewCadenceHint":
		"Uma revisão curta no fim de cada semana ou mês, mais a Revisão Anual em dezembro e o Relatório de Integridade em junho.",
	"settings.reviewCadence.weekly": "Semanal",
	"settings.reviewCadence.monthly": "Mensal",
	"settings.reviewCadence.off": "Desligado",
	"shortcuts.newEntry": "Nova entrada no diário",
	"shortcuts.goJournal": "Ir para o Diário",
	"notify.reviewTitle": "Hora da sua revisão semanal",
	"notify.reviewTitleMonth": "Hora da sua revisão mensal",
	"notify.reviewBody": "Três perguntas: o que deu certo, o que não deu, o que você aprendeu.",

	// ── Página do diário e editor ──
	"journal.title": "Diário",
	"journal.subtitle": "Evidências de quem você está se tornando",
	"journal.new": "Nova entrada",
	"journal.write": "Escrever",
	"journal.search": "Buscar no diário",
	"journal.filter.allIdentities": "Todas as identidades",
	"journal.filter.noIdentity": "Sem identidade",
	"journal.filter.dayNotes": "Notas do dia",
	"journal.filter.kinds": "Filtrar por tipo",
	"journal.filter.clear": "Limpar filtros",
	"journal.pinned": "Fixadas",
	"journal.pin": "Fixar",
	"journal.unpin": "Desafixar",
	"journal.delete": "Excluir entrada",
	"journal.deleted": "Entrada excluída",
	"journal.saving": "Salvando…",
	"journal.saved": "Salvo",
	"journal.unfinished": "Incompleta",
	"journal.required": "Obrigatório",
	"journal.anyOf": "Responda pelo menos uma destas.",
	"journal.empty": "Seu diário começa com uma linha",
	"journal.emptyBody":
		"Anote uma evidência de quem você está se tornando. Junte provas suficientes e o que você acredita sobre si mesmo começa a mudar.",
	"journal.emptyCta": "Escrever uma evidência",
	"journal.noMatches": "Nenhuma entrada com esses filtros.",
	"journal.about": "Sobre {date}",
	"journal.noHabit": "Sem hábito",
	"journal.noIdentity": "Sem identidade",
	"journal.deletedIdentity": "Identidade excluída",
	"journal.deletedHabit": "Hábito excluído",
	"journal.deletedIdentityName": "{name} (excluída)",
	"journal.deletedHabitName": "{name} (excluído)",
	"journal.dayNote": "Nota do dia · {habit}",
	"journal.newerVersion": "Criada em uma versão mais nova do Atomic.",
	"journal.privacy":
		"Seu diário fica neste dispositivo e sincroniza com sua conta quando você está conectado. No servidor ele não tem criptografia de ponta a ponta — desative Sincronizar diário para mantê-lo aqui. Ele nunca é enviado para IA.",
	"journal.card.label": "{kind}, {date}: {preview}",
	"journal.pickKind": "O que você quer escrever?",
	"journal.pickHabit": "Qual hábito?",
	"journal.needsBuildHabit": "Precisa de um hábito que você está construindo",
	"journal.needsHabit": "Precisa de um hábito",
	"journal.needsIdentity": "Precisa de uma identidade",
	"journal.makeTask": "Transformar em tarefa",
	"journal.taskCreated": "Adicionada às tarefas ✓",
	"journal.applyToHabit": "Usar como plano do hábito",
	"journal.habitUpdated": "Plano do hábito atualizado",
	"journal.group.quick": "Rápido",
	"journal.group.plan": "Planejar",
	"journal.group.reflect": "Refletir",
	"journal.group.free": "Livre",

	// ── Tipos (Anexo J §1.1) ──
	"journal.kind.evidence": "Evidência",
	"journal.kind.evidence.hint": "Uma prova de que você está se tornando quem quer ser",
	"journal.kind.awareness": "Perceber um hábito",
	"journal.kind.awareness.hint": "Aponte e diga em voz alta: a consciência vem antes da mudança",
	"journal.kind.recovery": "Plano de retomada",
	"journal.kind.recovery.hint": "Nunca falhe duas vezes: planeje a próxima repetição",
	"journal.kind.checkin": "Check-in Cachinhos Dourados",
	"journal.kind.checkin.hint": "Fácil demais, difícil demais ou na medida?",
	"journal.kind.contract": "Contrato de hábito",
	"journal.kind.contract.hint": "Torne caro quebrar a sua promessa",
	"journal.kind.belief": "Reescrever uma crença",
	"journal.kind.belief.hint": "Troque uma história antiga pela identidade em que você vota",
	"journal.kind.review": "Revisão",
	"journal.kind.review.hint": "O que foi bem, o que não foi, o que você aprendeu",
	"journal.kind.integrity": "Relatório de Integridade",
	"journal.kind.integrity.hint": "Seus valores, e o quanto você os vive",
	"journal.kind.note": "Nota livre",
	"journal.kind.note.hint": "Qualquer coisa sobre quem você está se tornando",

	// ── Parágrafos de abertura ──
	"journal.lead.evidence":
		"Cada ação que você realiza é um voto no tipo de pessoa que deseja se tornar.",
	"journal.lead.awareness":
		"A consciência vem antes da mudança. Esse comportamento ajuda você a se tornar quem quer ser?",
	"journal.lead.recovery":
		"Falhar uma vez é um acidente. Falhar duas vezes é o começo de um novo hábito. Decida agora a próxima repetição.",
	"journal.lead.recoveryBreak":
		"Seja gentil consigo: um deslize é informação, não um veredito. Encontre a deixa, esconda-a e acrescente atrito.",
	"journal.lead.checkin":
		"A motivação chega ao máximo em tarefas no limite da sua habilidade: nem fáceis, nem difíceis demais.",
	"journal.lead.contract":
		"Um contrato de hábito torna público e doloroso o custo de quebrar uma promessa.",
	"journal.lead.belief":
		"Decida que tipo de pessoa você quer ser. Prove isso para si mesmo com pequenas vitórias.",
	"journal.lead.review":
		"A reflexão evita que bons hábitos virem piloto automático. Estas são as três perguntas da Revisão Anual de James Clear.",
	"journal.lead.integrity":
		"Todo meio de ano, James Clear escreve um Relatório de Integridade: você vive de acordo com os valores que diz ter?",
	"journal.lead.note": "Escreva o que ajudar.",

	// ── Perguntas, exemplos e dicas ──
	"journal.prompt.evidence.text": "O que você fez que prova isso?",
	"journal.example.evidence.text": "Li 10 páginas no ônibus em vez de rolar o feed.",
	"journal.hint.evidence.text":
		"Pequenas vitórias contam. Cada uma é um voto em quem você está se tornando.",

	"journal.prompt.awareness.behavior": "O que você se pegou fazendo?",
	"journal.example.awareness.behavior": "Olhei o celular assim que acordei",
	"journal.hint.awareness.behavior":
		"Só descreva, sem julgar por enquanto: o objetivo é enxergar com clareza.",
	"journal.prompt.awareness.rating": "Isso é um voto a favor ou contra quem você quer ser?",
	"journal.prompt.awareness.say": "Diga em voz alta: aonde isso leva?",
	"journal.example.awareness.say":
		"Se eu continuar rolando o feed na cama, amanhã vou começar o dia sem energia.",
	"journal.hint.awareness.say":
		"Apontar e falar: dizer em voz alta a ação e a consequência tira o hábito do automático.",

	"journal.prompt.recovery.obstacle": "O que atrapalhou?",
	"journal.example.recovery.obstacle": "Trabalhei até tarde e fiquei sem energia.",
	"journal.hint.recovery.obstacle":
		"Olhe para o sistema, não para você: o que facilitou deixar para depois?",
	"journal.prompt.recovery.when": "Quando você vai fazer da próxima vez?",
	"journal.prompt.recovery.where": "Onde você vai fazer?",
	"journal.example.recovery.where": "na sala",
	"journal.prompt.recovery.after": "Logo depois de…",
	"journal.example.recovery.after": "passar o café da manhã",
	"journal.hint.recovery.after": "Empilhamento de hábitos: ligue a algo que você já faz todo dia.",
	"journal.prompt.recovery.twoMinute": "Num dia difícil, a versão de dois minutos é…",
	"journal.example.recovery.twoMinute": "Calçar o tênis de corrida",
	"journal.hint.recovery.twoMinute":
		"Deixe tão fácil que não dê para dizer não. Um hábito precisa existir antes de ser melhorado.",
	"journal.prompt.recovery.trigger": "O que provocou isso?",
	"journal.example.recovery.trigger": "Celular na cabeceira às 23h",
	"journal.hint.recovery.trigger":
		"Todo hábito começa com uma deixa. Descreva o momento logo antes do deslize.",
	"journal.prompt.recovery.cueType": "Que tipo de deixa foi?",
	"journal.prompt.recovery.hide": "Como tornar essa deixa invisível?",
	"journal.example.recovery.hide": "Carregar o celular na cozinha durante a noite",
	"journal.hint.recovery.hide":
		"Reduza a exposição: é mais fácil evitar a tentação do que resistir a ela.",
	"journal.prompt.recovery.friction": "Que atrito você pode adicionar?",
	"journal.example.recovery.friction": "Sair da conta do app depois de cada uso",
	"journal.hint.recovery.friction": "Torne difícil: coloque mais etapas entre você e o hábito.",
	"journal.recovery.yourPlan": "Seu plano",

	"journal.prompt.checkin.difficulty": "Como você está se sentindo com “{habit}” agora?",
	"journal.prompt.checkin.adjust": "O que você vai mudar?",
	"journal.example.checkin.adjust":
		"Manter 10 páginas; incluir um segundo livro nos fins de semana.",
	"journal.hint.checkin.adjust":
		"Ajustes pequenos, não revoluções: fique no limite da sua habilidade.",

	"journal.prompt.contract.commitment": "Eu me comprometo a…",
	"journal.example.contract.commitment": "Ler 10 páginas toda noite antes de dormir.",
	"journal.prompt.contract.consequence": "Se eu quebrar, eu vou…",
	"journal.example.contract.consequence": "pagar R$ 50 ao meu parceiro",
	"journal.hint.contract.consequence":
		"Escolha um custo que você pagaria de verdade e que alguém vai ver. Isso torna a escolha ruim insatisfatória.",

	"journal.prompt.belief.oldStory": "Uma história sobre você que te limita",
	"journal.example.belief.oldStory": "Eu simplesmente não sou uma pessoa da manhã.",
	"journal.hint.belief.oldStory":
		"Você não nasceu com essa crença. Você a aprendeu, então pode desaprendê-la.",
	"journal.prompt.belief.newStory": "A identidade em que você vota no lugar",
	"journal.example.belief.newStory": "Sou o tipo de pessoa que começa o dia cedo.",
	"journal.prompt.belief.proof": "Uma pequena vitória que provaria isso esta semana",
	"journal.example.belief.proof": "Acordar às 6h30 na terça.",
	"journal.hint.belief.proof":
		"Pequenas vitórias são evidências. Transforme em tarefa para que aconteça de verdade.",

	"journal.prompt.review.well": "O que foi bem?",
	"journal.example.review.well": "Li todos os dias e terminei um livro.",
	"journal.prompt.review.notWell": "O que não foi tão bem?",
	"journal.example.review.notWell": "Pulei dois treinos quando o trabalho apertou.",
	"journal.prompt.review.learned": "O que você aprendeu?",
	"journal.example.review.learned":
		"Deixar a mochila de treino pronta na noite anterior facilita as manhãs.",
	"journal.prompt.review.next": "Um ajuste no seu sistema",
	"journal.example.review.next": "Separar a roupa de corrida no domingo à noite",
	"journal.hint.review.next": "Você cai ao nível dos seus sistemas: mude uma pequena coisa neles.",

	"journal.prompt.integrity.values":
		"Quais são os valores centrais que guiam sua vida e seu trabalho?",
	"journal.example.integrity.values": "Curiosidade, saúde, presença com minha família.",
	"journal.prompt.integrity.living": "Como você está vivendo e trabalhando com integridade agora?",
	"journal.example.integrity.living":
		"Em boa parte: as manhãs são calmas, mas as noites ainda vão para o celular.",
	"journal.prompt.integrity.standard": "Como você pode elevar o padrão daqui para a frente?",
	"journal.example.integrity.standard": "Celular fora do quarto, todas as noites.",

	"journal.prompt.note.text": "O que está passando pela sua cabeça?",
	"journal.example.note.text":
		"Percebi que os dias em que vou a pé para o trabalho são mais tranquilos.",

	// ── Perceber um hábito ──
	"journal.rating.positive": "A favor",
	"journal.rating.neutral": "Neutro",
	"journal.rating.negative": "Contra",
	"journal.awareness.addToScorecard": "Adicionar ao meu Scorecard de hábitos",
	"journal.awareness.onScorecard": "Já está no seu Scorecard ✓",
	"journal.awareness.added": "Adicionado ao seu Scorecard de hábitos",
	"journal.awareness.breakHabit": "Abandonar este hábito",

	// ── Check-in Cachinhos Dourados ──
	"journal.difficulty.too-easy": "Fácil demais — virou tédio",
	"journal.difficulty.just-right": "Na medida",
	"journal.difficulty.too-hard": "Difícil demais",
	"journal.goldilocks.raise": "Aumentar a meta diária para {target}",
	"journal.goldilocks.lower": "Reduzir a meta diária para {target}",
	"journal.goldilocks.easyTip": "Crie uma versão mais difícil, como uma sessão mais longa.",
	"journal.goldilocks.useTwoMinute": "Faça só a versão de dois minutos: {twoMinute}",
	"journal.goldilocks.defineTwoMinute": "Definir uma versão de dois minutos",
	"journal.goldilocks.hard":
		"Reduza até ficar fácil começar. Um hábito precisa existir antes de ser melhorado.",
	"journal.goldilocks.right":
		"Na medida. Quando ficar chato, continue aparecendo: profissionais seguem a agenda.",
	"journal.goldilocks.easy":
		"A maior ameaça ao sucesso não é o fracasso, é o tédio. Deixe um pouco mais difícil.",
	"journal.goldilocks.applied": "Meta diária atualizada",

	// ── Contrato de hábito ──
	"journal.contract.commitmentDefault": "Vou {habit}, {schedule}.",
	"journal.contract.commitmentDays": "Vou {habit} nestes dias: {days}.",
	"journal.contract.partner": "Parceiro de responsabilidade",
	"journal.contract.partnerPlaceholder": "Alguém que vai cobrar você",
	"journal.contract.until": "Até",
	"journal.contract.sign": "Assinar contrato",
	"journal.contract.signHint":
		"Preencha o compromisso, a consequência e a data final para assinar.",
	"journal.contract.signedToast": "Contrato assinado. Agora compartilhe com seu parceiro.",
	"journal.contract.revoke": "Revogar assinatura",
	"journal.contract.locked":
		"Contratos assinados ficam bloqueados. Revogue a assinatura para editar.",
	"journal.contract.signed": "Assinado em {date}",
	"journal.contract.active": "Vale até {date}",
	"journal.contract.draft": "Rascunho",
	"journal.contract.ended": "Encerrado",
	"journal.contract.kept": "Cumprido",
	"journal.contract.broken": "Quebrado",
	"journal.contract.keptAction": "Cumpri",
	"journal.contract.brokenAction": "Não cumpri",
	"journal.contract.share": "Compartilhar com seu parceiro",
	"journal.contract.copied": "Contrato copiado",
	"journal.contract.textTitle": "Contrato de hábito",
	"journal.contract.textConsequence": "Se eu quebrar: {consequence}",
	"journal.contract.textUntil": "Válido até {until}.",
	"journal.contract.textSigned": "Assinado: {name}, {date}",
	"journal.contract.textSignedNoName": "Assinado em {date}",
	"journal.contract.textUnsigned": "Ainda não assinado.",
	"journal.contract.textPartner": "Parceiro de responsabilidade: {partner}",

	// ── Revisões, períodos e os números ──
	"journal.review.scope.week": "Revisão semanal",
	"journal.review.scope.month": "Revisão mensal",
	"journal.review.scope.year": "Revisão Anual",
	"journal.review.previous": "Período anterior",
	"journal.review.next": "Próximo período",
	"journal.range.week": "Semana de {date}",
	"journal.range.span": "{from} – {to}",
	"journal.snapshot.title": "Os números",
	"journal.snapshot.votes": "Votos",
	"journal.snapshot.consistency": "Consistência",
	"journal.snapshot.perfectDays": "Dias perfeitos",
	"journal.snapshot.slips": "Deslizes",
	"journal.snapshot.evidence": "Evidências anotadas",
	"journal.snapshot.byIdentity": "Votos por identidade",
	"journal.snapshot.top": "Mais consistentes",
	"journal.snapshot.ofDue": "{done} de {due}",
	"journal.snapshot.missedTwice": "Falhou duas vezes seguidas: {habits}",
	"journal.snapshot.neverMissedTwice": "Você nunca falhou duas vezes seguidas.",
	"journal.snapshot.empty": "Nada foi registrado neste período.",

	// ── Hoje: o convite do diário ──
	"journal.nudge.dismiss": "Agora não",
	"journal.nudge.dismissLabel": "Dispensar: {title}",
	"journal.nudge.slip.title": "O que provocou isso?",
	"journal.nudge.slip.body":
		"Você registrou um deslize em {habit}. Dois minutos de reflexão tornam a deixa mais fácil de perceber da próxima vez.",
	"journal.nudge.slip.cta": "Refletir",
	"journal.nudge.contract.title": "Contrato encerrado",
	"journal.nudge.contract.body": "Seu contrato para {habit} terminou em {date}. Você cumpriu?",
	"journal.nudge.contract.open": "Abrir",
	"journal.nudge.review.body":
		"Três perguntas, três minutos: o que foi bem, o que não foi, o que você aprendeu.",
	"journal.nudge.review.cta": "Começar revisão",
	"journal.nudge.year.body":
		"Olhe para {year}: os votos que você deu e a pessoa que eles construíram.",
	"journal.nudge.integrity.body": "Metade do ano: você vive os valores que diz ter?",
	"journal.nudge.integrity.cta": "Começar",
	"journal.nudge.evidence.title": "Junte suas evidências",
	"journal.nudge.evidence.body":
		"Você deu {votes} votos em “{identity}” esta semana. Anote um deles como prova.",
	"journal.nudge.evidence.cta": "Escrever evidência",

	// ── Avisos de Hoje e o card de dia perfeito ──
	"journal.nmt.plan": "Planejar a retomada",
	"journal.nmt.freshPlan": "Planejar um recomeço",
	"journal.nmt.yourPlan": "Seu plano: {plan}",
	"journal.nmt.editPlan": "Editar plano",
	"journal.nmt.planSaved": "Plano salvo",
	"journal.proof.cta": "Anotar a prova",

	// ── Detalhe do hábito ──
	"journal.checkin.strong.title": "Ainda está na medida?",
	"journal.checkin.strong.body":
		"{habit} está ficando automático. Hábitos fáceis demais ficam chatos. Faça um check-in.",
	"journal.checkin.struggling.title": "{habit} está difícil demais agora?",
	"journal.checkin.struggling.body": "Reduzir não é desistir. Faça um check-in e ajuste.",
	"journal.checkin.cta": "Fazer check-in",
	"journal.habit.title": "Diário e notas",
	"journal.habit.empty": "Planos, check-ins e notas deste hábito aparecem aqui.",
	"journal.habit.seeAll": "Ver tudo no Diário",
	"journal.habit.contract": "Contrato de hábito · vale até {date}",
	"journal.habit.contractWith": "Contrato de hábito · vale até {date} · com {partner}",

	// ── Identidade: evidências e valores ──
	"journal.evidence.count.one": "{count} evidência",
	"journal.evidence.count.other": "{count} evidências",
	"journal.evidence.quickPlaceholder": "O que você fez hoje que prova isso?",
	"journal.evidence.quickLabel": "Evidência para “{identity}”",
	"journal.evidence.added": "Evidência salva. As provas se acumulam.",
	"journal.evidence.add": "Evidência",
	"journal.values.title": "Seus valores",
	"journal.values.updated": "Do seu Relatório de Integridade, {date}",
};
