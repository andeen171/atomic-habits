import { type DayKey, diffDays } from "./dates";
import type { Locale } from "./i18n";
import type { HabitColor, HabitKind, Schedule, TimeOfDay } from "./model";

type Localized = { en: string; pt: string };
const pick = (value: Localized, locale: Locale) => (locale === "pt-BR" ? value.pt : value.en);

export interface Principle {
	id: string;
	/** 0 = general, 1–4 = law of behavior change, 5 = breaking bad habits. */
	law: 0 | 1 | 2 | 3 | 4 | 5;
	title: string;
	body: string;
}

const PRINCIPLES: { id: string; law: Principle["law"]; title: Localized; body: Localized }[] = [
	{
		id: "compound",
		law: 0,
		title: { en: "Habits compound", pt: "Hábitos se acumulam" },
		body: {
			en: "Small habits don't add up — they compound. The same tiny change, repeated daily, becomes the gap between who you are and who you could be.",
			pt: "Pequenos hábitos não somam — eles se multiplicam. A mesma mudança minúscula, repetida todo dia, vira a distância entre quem você é e quem poderia ser.",
		},
	},
	{
		id: "systems",
		law: 0,
		title: { en: "Systems over goals", pt: "Sistemas acima de metas" },
		body: {
			en: "Goals set the direction; systems make the progress. Fall in love with the process and the results will follow.",
			pt: "Metas dão a direção; sistemas fazem o progresso. Apaixone-se pelo processo e os resultados virão.",
		},
	},
	{
		id: "identity",
		law: 0,
		title: { en: "Identity first", pt: "Identidade primeiro" },
		body: {
			en: "Every action is a vote for the person you want to become. You don't need a unanimous vote — just a majority.",
			pt: "Cada ação é um voto na pessoa que você quer se tornar. Você não precisa de unanimidade — só da maioria.",
		},
	},
	{
		id: "never-miss-twice",
		law: 0,
		title: { en: "Never miss twice", pt: "Nunca falhe duas vezes" },
		body: {
			en: "Missing once is an accident. Missing twice is the start of a new habit. When you slip, get back on track fast.",
			pt: "Falhar uma vez é um acidente. Falhar duas vezes é o começo de um novo hábito. Se escorregar, retome rápido.",
		},
	},
	{
		id: "intention",
		law: 1,
		title: { en: "Implementation intentions", pt: "Intenções de implementação" },
		body: {
			en: "Vague plans fail. Decide exactly when and where: “I will [habit] at [time] in [place].”",
			pt: "Planos vagos falham. Decida exatamente quando e onde: “Vou [hábito] às [hora] em [lugar].”",
		},
	},
	{
		id: "stacking",
		law: 1,
		title: { en: "Habit stacking", pt: "Empilhamento de hábitos" },
		body: {
			en: "Anchor a new habit to one you already do: “After I pour my coffee, I will meditate for one minute.”",
			pt: "Ancore um novo hábito em algo que você já faz: “Depois de passar o café, vou meditar por um minuto.”",
		},
	},
	{
		id: "environment",
		law: 1,
		title: { en: "Design your environment", pt: "Desenhe seu ambiente" },
		body: {
			en: "Make the cues of good habits impossible to miss. Book on the pillow, water bottle on the desk, guitar in the middle of the room.",
			pt: "Deixe as deixas dos bons hábitos impossíveis de ignorar. Livro no travesseiro, garrafa de água na mesa, violão no meio da sala.",
		},
	},
	{
		id: "bundling",
		law: 2,
		title: { en: "Temptation bundling", pt: "Agrupamento de tentações" },
		body: {
			en: "Pair something you want to do with something you need to do. Your favorite podcast — only while you walk.",
			pt: "Junte algo que você quer fazer com algo que precisa fazer. Seu podcast favorito — só durante a caminhada.",
		},
	},
	{
		id: "tribe",
		law: 2,
		title: { en: "Join the right tribe", pt: "Entre para a tribo certa" },
		body: {
			en: "We absorb the habits of the people around us. Spend time where your desired behavior is the normal behavior.",
			pt: "Absorvemos os hábitos de quem está ao nosso redor. Conviva onde o comportamento que você deseja é o normal.",
		},
	},
	{
		id: "reframe",
		law: 2,
		title: { en: "“I get to”", pt: "“Eu posso”" },
		body: {
			en: "Swap “I have to” for “I get to”. The same task feels different once you see it as an opportunity.",
			pt: "Troque “eu tenho que” por “eu posso”. A mesma tarefa muda quando você a enxerga como oportunidade.",
		},
	},
	{
		id: "two-minute",
		law: 3,
		title: { en: "The two-minute rule", pt: "A regra dos dois minutos" },
		body: {
			en: "A new habit should take less than two minutes to start. A habit must be established before it can be improved.",
			pt: "Um novo hábito deve levar menos de dois minutos para começar. Um hábito precisa existir antes de ser melhorado.",
		},
	},
	{
		id: "friction",
		law: 3,
		title: { en: "Reduce friction", pt: "Reduza o atrito" },
		body: {
			en: "The easier a behavior is, the more likely it happens. Prepare tonight so tomorrow's first step is effortless.",
			pt: "Quanto mais fácil o comportamento, mais provável que aconteça. Prepare hoje à noite para que o primeiro passo de amanhã seja natural.",
		},
	},
	{
		id: "reps",
		law: 3,
		title: { en: "Reps, not time", pt: "Repetições, não tempo" },
		body: {
			en: "Habits form through frequency, not through how many days have passed. Focus on getting your reps in.",
			pt: "Hábitos se formam pela frequência, não pela quantidade de dias que passaram. Foque em acumular repetições.",
		},
	},
	{
		id: "motion",
		law: 3,
		title: { en: "Motion vs. action", pt: "Movimento vs. ação" },
		body: {
			en: "Planning feels productive, but only action delivers results. Take the smallest real step now.",
			pt: "Planejar parece produtivo, mas só a ação traz resultados. Dê agora o menor passo real.",
		},
	},
	{
		id: "immediate",
		law: 4,
		title: { en: "Reward it right away", pt: "Recompense na hora" },
		body: {
			en: "What is immediately rewarded is repeated. Give yourself a small win the moment the habit is done.",
			pt: "O que é recompensado imediatamente é repetido. Dê a si mesmo uma pequena vitória assim que terminar.",
		},
	},
	{
		id: "tracking",
		law: 4,
		title: { en: "Don't break the chain", pt: "Não quebre a corrente" },
		body: {
			en: "Seeing your progress is satisfying on its own. Every check mark is proof that you're becoming who you want to be.",
			pt: "Ver o progresso já é satisfatório. Cada marcação é a prova de que você está se tornando quem deseja.",
		},
	},
	{
		id: "accountability",
		law: 4,
		title: { en: "Find accountability", pt: "Tenha responsabilidade" },
		body: {
			en: "A friend watching — or a simple habit contract — makes skipping costly and showing up satisfying.",
			pt: "Um amigo acompanhando — ou um simples contrato de hábito — torna faltar caro e aparecer satisfatório.",
		},
	},
	{
		id: "invisible",
		law: 5,
		title: { en: "Make bad habits invisible", pt: "Torne os maus hábitos invisíveis" },
		body: {
			en: "Self-control is a short-term strategy. People with great self-control simply spend less time in tempting situations.",
			pt: "Autocontrole é estratégia de curto prazo. Quem parece ter muito autocontrole simplesmente passa menos tempo em situações tentadoras.",
		},
	},
	{
		id: "difficult",
		law: 5,
		title: { en: "Make bad habits difficult", pt: "Torne os maus hábitos difíceis" },
		body: {
			en: "Add steps between you and the habit. Unplug the TV, log out of the app, leave the card at home.",
			pt: "Adicione passos entre você e o hábito. Desligue a TV da tomada, saia do aplicativo, deixe o cartão em casa.",
		},
	},
	{
		id: "plateau",
		law: 0,
		title: { en: "The plateau of latent potential", pt: "O platô do potencial latente" },
		body: {
			en: "Results lag behind effort. Ice doesn't melt from 25° to 31° — then at 32° it does. The work wasn't wasted; it was stored.",
			pt: "Os resultados chegam depois do esforço. O gelo não derrete de -4 °C a -1 °C — e a 0 °C, derrete. O trabalho não foi perdido; foi armazenado.",
		},
	},
	{
		id: "goldilocks",
		law: 0,
		title: { en: "The Goldilocks rule", pt: "A regra da Cachinhos Dourados" },
		body: {
			en: "Motivation peaks on tasks right at the edge of your ability — not too easy, not too hard. Level up just a little.",
			pt: "A motivação é máxima em tarefas no limite da sua habilidade — nem fáceis, nem difíceis demais. Suba um pouco de nível.",
		},
	},
	{
		id: "professional",
		law: 0,
		title: { en: "Show up like a pro", pt: "Apareça como profissional" },
		body: {
			en: "Amateurs wait for motivation. Professionals stick to the schedule, even when it's boring.",
			pt: "Amadores esperam a motivação. Profissionais seguem a agenda, mesmo quando é chato.",
		},
	},
	{
		id: "decisive",
		law: 0,
		title: { en: "Decisive moments", pt: "Momentos decisivos" },
		body: {
			en: "A handful of small choices each day steer the next few hours. Win those moments and the rest follows.",
			pt: "Algumas pequenas escolhas por dia definem as horas seguintes. Vença esses momentos e o resto acompanha.",
		},
	},
	{
		id: "awareness",
		law: 0,
		title: { en: "Awareness comes first", pt: "Primeiro, a consciência" },
		body: {
			en: "You can't change a habit you don't notice. Point it out and say it out loud.",
			pt: "Você não muda um hábito que não percebe. Aponte-o e diga em voz alta.",
		},
	},
	{
		id: "small-wins",
		law: 0,
		title: { en: "Small wins are evidence", pt: "Pequenas vitórias são evidências" },
		body: {
			en: "Each win is proof. Collect enough proof and your beliefs about yourself begin to change.",
			pt: "Cada vitória é uma prova. Junte provas suficientes e suas crenças sobre si mesmo começam a mudar.",
		},
	},
	{
		id: "boredom",
		law: 0,
		title: { en: "Fall in love with boredom", pt: "Apaixone-se pelo tédio" },
		body: {
			en: "Mastery is repetition after the novelty fades. Keep going when it stops being exciting.",
			pt: "Maestria é repetir depois que a novidade passa. Continue quando deixar de ser empolgante.",
		},
	},
	{
		id: "one-percent",
		law: 0,
		title: { en: "1% better", pt: "1% melhor" },
		body: {
			en: "Get 1% better each day for a year and you end up nearly 38 times better. Tiny gains, remarkable results.",
			pt: "Fique 1% melhor por dia durante um ano e você termina quase 38 vezes melhor. Pequenos ganhos, resultados notáveis.",
		},
	},
];

export function principles(locale: Locale): Principle[] {
	return PRINCIPLES.map((p) => ({
		id: p.id,
		law: p.law,
		title: pick(p.title, locale),
		body: pick(p.body, locale),
	}));
}

/** A stable principle for each calendar day. */
export function principleOfTheDay(day: DayKey, locale: Locale): Principle {
	const list = principles(locale);
	const index = ((diffDays(day, "2024-01-01") % list.length) + list.length) % list.length;
	return list[index] as Principle;
}

export interface HabitTemplate {
	key: string;
	name: string;
	emoji: string;
	color: HabitColor;
	kind: HabitKind;
	target: number;
	unit: string | null;
	schedule: Schedule;
	timeOfDay: TimeOfDay;
	cueTime: string | null;
	cueLocation: string | null;
	stackAfter: string | null;
	twoMinute: string | null;
	bundle: string | null;
	reward: string | null;
	environment: string | null;
}

export interface IdentityTemplate {
	key: string;
	statement: string;
	emoji: string;
	color: HabitColor;
	habits: HabitTemplate[];
}

interface RawHabit {
	key: string;
	name: Localized;
	emoji: string;
	kind?: HabitKind;
	target?: number;
	unit?: Localized;
	schedule?: Schedule;
	timeOfDay: TimeOfDay;
	cueTime?: string;
	cueLocation?: Localized;
	stackAfter?: Localized;
	twoMinute?: Localized;
	bundle?: Localized;
	reward?: Localized;
	environment?: Localized;
}

interface RawIdentity {
	key: string;
	statement: Localized;
	emoji: string;
	color: HabitColor;
	habits: RawHabit[];
}

const IDENTITIES: RawIdentity[] = [
	{
		key: "reader",
		statement: { en: "I am a reader", pt: "Sou uma pessoa que lê todos os dias" },
		emoji: "📚",
		color: "amber",
		habits: [
			{
				key: "read",
				name: { en: "Read 10 pages", pt: "Ler 10 páginas" },
				emoji: "📖",
				target: 10,
				unit: { en: "pages", pt: "páginas" },
				timeOfDay: "evening",
				cueTime: "21:30",
				cueLocation: { en: "in bed", pt: "na cama" },
				twoMinute: { en: "Read one page", pt: "Ler uma página" },
				environment: {
					en: "Book on my pillow every morning",
					pt: "Livro no travesseiro toda manhã",
				},
				reward: { en: "A cup of tea while I read", pt: "Um chá enquanto leio" },
			},
		],
	},
	{
		key: "athlete",
		statement: { en: "I am an active person", pt: "Sou uma pessoa ativa" },
		emoji: "🏃",
		color: "ember",
		habits: [
			{
				key: "workout",
				name: { en: "Work out", pt: "Treinar" },
				emoji: "💪",
				schedule: { type: "weekly", times: 3 },
				timeOfDay: "morning",
				cueTime: "07:00",
				twoMinute: { en: "Put on my workout clothes", pt: "Vestir a roupa de treino" },
				bundle: { en: "listen to my favorite podcast", pt: "ouvir meu podcast favorito" },
				environment: { en: "Gym bag packed by the door", pt: "Mochila de treino pronta na porta" },
			},
			{
				key: "walk",
				name: { en: "Take a walk", pt: "Caminhar" },
				emoji: "🚶",
				timeOfDay: "afternoon",
				stackAfter: { en: "finish lunch", pt: "terminar o almoço" },
				twoMinute: { en: "Walk to the end of the street", pt: "Andar até o fim da rua" },
			},
		],
	},
	{
		key: "mindful",
		statement: { en: "I am calm and present", pt: "Sou uma pessoa calma e presente" },
		emoji: "🧘",
		color: "teal",
		habits: [
			{
				key: "meditate",
				name: { en: "Meditate", pt: "Meditar" },
				emoji: "🧘",
				timeOfDay: "morning",
				stackAfter: { en: "pour my morning coffee", pt: "passar o café da manhã" },
				twoMinute: { en: "Take ten slow breaths", pt: "Respirar fundo dez vezes" },
				cueLocation: { en: "on the living room couch", pt: "no sofá da sala" },
			},
			{
				key: "journal",
				name: { en: "Journal", pt: "Escrever no diário" },
				emoji: "📓",
				timeOfDay: "evening",
				twoMinute: { en: "Write one line about today", pt: "Escrever uma linha sobre o dia" },
				stackAfter: { en: "brush my teeth at night", pt: "escovar os dentes à noite" },
			},
		],
	},
	{
		key: "healthy",
		statement: { en: "I take care of my body", pt: "Cuido bem do meu corpo" },
		emoji: "🥗",
		color: "emerald",
		habits: [
			{
				key: "water",
				name: { en: "Drink water", pt: "Beber água" },
				emoji: "💧",
				target: 8,
				unit: { en: "glasses", pt: "copos" },
				timeOfDay: "anytime",
				twoMinute: { en: "Drink one glass now", pt: "Beber um copo agora" },
				environment: { en: "Water bottle always on my desk", pt: "Garrafa sempre na mesa" },
			},
			{
				key: "vegetables",
				name: { en: "Eat vegetables", pt: "Comer vegetais" },
				emoji: "🥦",
				timeOfDay: "afternoon",
				twoMinute: { en: "Add one vegetable to lunch", pt: "Pôr um vegetal no almoço" },
			},
			{
				key: "sleep",
				name: { en: "In bed by 11pm", pt: "Deitar até 23h" },
				emoji: "😴",
				timeOfDay: "evening",
				cueTime: "22:30",
				twoMinute: { en: "Put the phone on the charger", pt: "Colocar o celular para carregar" },
			},
		],
	},
	{
		key: "writer",
		statement: { en: "I am a writer", pt: "Sou uma pessoa que escreve" },
		emoji: "✍️",
		color: "violet",
		habits: [
			{
				key: "write",
				name: { en: "Write 300 words", pt: "Escrever 300 palavras" },
				emoji: "✍️",
				schedule: { type: "weekdays", days: [1, 2, 3, 4, 5] },
				timeOfDay: "morning",
				cueTime: "08:00",
				cueLocation: { en: "at my desk", pt: "na minha mesa" },
				twoMinute: { en: "Write one sentence", pt: "Escrever uma frase" },
			},
		],
	},
	{
		key: "learner",
		statement: { en: "I never stop learning", pt: "Sou uma pessoa que aprende sempre" },
		emoji: "🧠",
		color: "indigo",
		habits: [
			{
				key: "language",
				name: { en: "Practice a language", pt: "Praticar um idioma" },
				emoji: "🗣️",
				target: 15,
				unit: { en: "min", pt: "min" },
				timeOfDay: "anytime",
				stackAfter: { en: "sit on the bus", pt: "sentar no ônibus" },
				twoMinute: { en: "Do one lesson", pt: "Fazer uma lição" },
			},
			{
				key: "instrument",
				name: { en: "Practice an instrument", pt: "Tocar um instrumento" },
				emoji: "🎸",
				schedule: { type: "weekly", times: 4 },
				timeOfDay: "evening",
				twoMinute: { en: "Play one scale", pt: "Tocar uma escala" },
				environment: {
					en: "Guitar on a stand in the living room",
					pt: "Violão no suporte, no meio da sala",
				},
			},
		],
	},
	{
		key: "early",
		statement: { en: "I am an early riser", pt: "Sou uma pessoa que acorda cedo" },
		emoji: "🌅",
		color: "sky",
		habits: [
			{
				key: "wake",
				name: { en: "Wake up at 6:30", pt: "Acordar às 6h30" },
				emoji: "⏰",
				timeOfDay: "morning",
				cueTime: "06:30",
				twoMinute: {
					en: "Feet on the floor, open the curtains",
					pt: "Pés no chão, abrir a cortina",
				},
				environment: { en: "Alarm across the room", pt: "Despertador longe da cama" },
			},
		],
	},
	{
		key: "organized",
		statement: { en: "I am organized", pt: "Sou uma pessoa organizada" },
		emoji: "🗂️",
		color: "stone",
		habits: [
			{
				key: "plan",
				name: { en: "Plan tomorrow", pt: "Planejar o amanhã" },
				emoji: "🗒️",
				schedule: { type: "weekdays", days: [1, 2, 3, 4, 5] },
				timeOfDay: "evening",
				stackAfter: { en: "close my laptop", pt: "fechar o notebook" },
				twoMinute: { en: "Write my top 3 for tomorrow", pt: "Anotar 3 prioridades de amanhã" },
			},
			{
				key: "tidy",
				name: { en: "Tidy up for 5 minutes", pt: "Arrumar por 5 minutos" },
				emoji: "🧹",
				timeOfDay: "evening",
				twoMinute: { en: "Put one thing back in place", pt: "Guardar uma coisa no lugar" },
			},
		],
	},
	{
		key: "saver",
		statement: { en: "I am good with money", pt: "Cuido bem do meu dinheiro" },
		emoji: "💰",
		color: "lime",
		habits: [
			{
				key: "expenses",
				name: { en: "Log expenses", pt: "Anotar gastos" },
				emoji: "🧾",
				timeOfDay: "evening",
				twoMinute: {
					en: "Log just today's first purchase",
					pt: "Anotar só a primeira compra do dia",
				},
			},
			{
				key: "impulse",
				name: { en: "Impulse buying", pt: "Compras por impulso" },
				emoji: "🛍️",
				kind: "break",
				timeOfDay: "anytime",
				cueLocation: { en: "Shopping apps at night", pt: "Apps de compras à noite" },
				environment: { en: "Delete saved cards from apps", pt: "Apagar cartões salvos nos apps" },
				twoMinute: {
					en: "Wait 30 days before any non-essential purchase",
					pt: "Esperar 30 dias antes de compras não essenciais",
				},
			},
		],
	},
	{
		key: "present",
		statement: { en: "I am present with the people I love", pt: "Estou presente para quem eu amo" },
		emoji: "🫶",
		color: "rose",
		habits: [
			{
				key: "doomscroll",
				name: { en: "Doomscrolling", pt: "Rolar o feed sem parar" },
				emoji: "📵",
				kind: "break",
				timeOfDay: "anytime",
				cueLocation: { en: "Phone on the nightstand", pt: "Celular na mesa de cabeceira" },
				environment: {
					en: "Charge the phone outside the bedroom",
					pt: "Carregar o celular fora do quarto",
				},
				bundle: { en: "It steals my mornings and my focus", pt: "Rouba minhas manhãs e meu foco" },
				twoMinute: {
					en: "Log out of social apps after each use",
					pt: "Sair das redes depois de cada uso",
				},
			},
			{
				key: "call",
				name: { en: "Call someone I love", pt: "Ligar para alguém que amo" },
				emoji: "📞",
				schedule: { type: "weekly", times: 2 },
				timeOfDay: "evening",
				twoMinute: { en: "Send a voice message", pt: "Mandar um áudio" },
			},
		],
	},
];

function localizeHabit(raw: RawHabit, color: HabitColor, locale: Locale): HabitTemplate {
	const opt = (v: Localized | undefined) => (v ? pick(v, locale) : null);
	return {
		key: raw.key,
		name: pick(raw.name, locale),
		emoji: raw.emoji,
		color,
		kind: raw.kind ?? "build",
		target: raw.target ?? 1,
		unit: opt(raw.unit),
		schedule: raw.schedule ?? { type: "daily" },
		timeOfDay: raw.timeOfDay,
		cueTime: raw.cueTime ?? null,
		cueLocation: opt(raw.cueLocation),
		stackAfter: opt(raw.stackAfter),
		twoMinute: opt(raw.twoMinute),
		bundle: opt(raw.bundle),
		reward: opt(raw.reward),
		environment: opt(raw.environment),
	};
}

export function identityTemplates(locale: Locale): IdentityTemplate[] {
	return IDENTITIES.map((identity) => ({
		key: identity.key,
		statement: pick(identity.statement, locale),
		emoji: identity.emoji,
		color: identity.color,
		habits: identity.habits.map((h) => localizeHabit(h, identity.color, locale)),
	}));
}

export function habitTemplates(locale: Locale): HabitTemplate[] {
	return identityTemplates(locale).flatMap((identity) => identity.habits);
}

/** Curated emoji for the habit/identity picker. */
export const EMOJI_CHOICES = [
	"✨",
	"📖",
	"📚",
	"✍️",
	"🧘",
	"🏃",
	"💪",
	"🚶",
	"🚴",
	"🏊",
	"🧗",
	"⚽",
	"💧",
	"🥦",
	"🍎",
	"🥗",
	"😴",
	"⏰",
	"🌅",
	"☀️",
	"🌙",
	"🧠",
	"🗣️",
	"🎸",
	"🎹",
	"🎨",
	"📷",
	"💻",
	"🧾",
	"💰",
	"🗒️",
	"🧹",
	"🪴",
	"🐕",
	"📞",
	"🫶",
	"🙏",
	"😊",
	"🦷",
	"💊",
	"🚭",
	"📵",
	"🍷",
	"🍬",
	"🛍️",
	"🎮",
	"📺",
	"☕",
] as const;
