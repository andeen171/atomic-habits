import { z } from "zod";
import { LOCALES, type Locale } from "./i18n";
import { HABIT_KINDS, TIMES_OF_DAY } from "./model";
import { timeSchema } from "./primitives";

/**
 * AI beta contracts shared by the client (T5) and the server (T6) (Annex C
 * §1.6 and §2.5, as amended by spec §3.1).
 *
 * D19: the journal is never sent to AI, so there is no journal kind
 * (`journal.followUp` is removed for v2). Inputs carry only the text being
 * asked about plus the related habit or identity name, never history.
 *
 * Inputs are capped (the server answers 400 past a cap) and their unknown
 * keys are stripped, so nothing else ever reaches a prompt; outputs are
 * `looseObject`s because the client parses server responses with them.
 * The server derives the model's JSON schemas from the output schemas with
 * `z.toJSONSchema()`.
 *
 * Runtime imports: zod, `i18n`, `model`, `primitives` (React-free).
 */

export const AI_SUGGEST_KINDS = [
	"habit.name",
	"habit.twoMinute",
	"habit.intention",
	"habit.stack",
	"habit.laws",
	"habit.setupTasks",
	"identity.statement",
	"task.firstStep",
] as const;
export type AiSuggestKind = (typeof AI_SUGGEST_KINDS)[number];

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const habitName = text(1, 120);
const kind = z.enum(HABIT_KINDS);

/** Per-kind inputs (caps from Annex C §1.6, characters). */
export const aiSuggestInputSchemas = {
	"habit.name": z.object({
		partial: z.string().trim().max(80).optional(),
		identity: z.string().trim().max(120).optional(),
		kind,
	}),
	"habit.twoMinute": z.object({ habit: habitName, kind }),
	"habit.intention": z.object({
		habit: habitName,
		kind,
		timeOfDay: z.enum(TIMES_OF_DAY).optional(),
	}),
	"habit.stack": z.object({
		habit: habitName,
		/** The user's own build-habit names, as candidate anchors. */
		anchors: z.array(z.string().trim().max(80)).max(10).optional(),
	}),
	"habit.laws": z.object({
		habit: habitName,
		kind,
		identity: z.string().trim().max(120).optional(),
	}),
	"habit.setupTasks": z.object({
		habit: habitName,
		kind,
		identity: z.string().trim().max(120).optional(),
	}),
	"identity.statement": z.object({ goal: text(2, 160) }),
	"task.firstStep": z.object({ task: text(1, 200) }),
} as const satisfies Record<AiSuggestKind, z.ZodType>;

const items = <T extends z.ZodType>(item: T, max: number) =>
	z.looseObject({ items: z.array(item).min(1).max(max) });

/** Per-kind outputs. For break habits, `habit.laws` holds the inverted laws. */
export const aiSuggestOutputSchemas = {
	"habit.name": items(text(2, 60), 5),
	"habit.twoMinute": items(text(2, 80), 4),
	"habit.intention": items(
		z.looseObject({
			time: timeSchema.nullable(),
			location: text(2, 60),
			sentence: text(5, 140),
		}),
		3,
	),
	"habit.stack": items(text(3, 80), 4),
	"habit.laws": z.looseObject({
		obvious: text(3, 140),
		attractive: text(3, 140),
		easy: text(3, 140),
		satisfying: text(3, 140),
	}),
	"habit.setupTasks": items(
		z.looseObject({
			title: text(3, 80),
			law: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
		}),
		5,
	),
	"identity.statement": items(text(3, 80), 4),
	"task.firstStep": items(text(3, 80), 3),
} as const satisfies Record<AiSuggestKind, z.ZodType>;

export type AiSuggestInput<K extends AiSuggestKind> = z.infer<(typeof aiSuggestInputSchemas)[K]>;
export type AiSuggestOutput<K extends AiSuggestKind> = z.infer<(typeof aiSuggestOutputSchemas)[K]>;

const locale = z.enum(LOCALES as unknown as [Locale, ...Locale[]]);

const suggestVariant = <K extends AiSuggestKind>(k: K) =>
	z.object({ kind: z.literal(k), locale, input: aiSuggestInputSchemas[k] });

/** `POST /trpc/ai.suggest`. */
export const aiSuggestRequestSchema = z.discriminatedUnion("kind", [
	suggestVariant("habit.name"),
	suggestVariant("habit.twoMinute"),
	suggestVariant("habit.intention"),
	suggestVariant("habit.stack"),
	suggestVariant("habit.laws"),
	suggestVariant("habit.setupTasks"),
	suggestVariant("identity.statement"),
	suggestVariant("task.firstStep"),
]);
export type AiSuggestRequest = z.infer<typeof aiSuggestRequestSchema>;

/** Summed characters of one translate request. */
export const AI_TRANSLATE_MAX_CHARS = 1500;

/** `POST /trpc/ai.translate`: at most 20 items and 1500 characters in all. */
export const aiTranslateRequestSchema = z
	.object({
		target: locale,
		items: z
			.array(z.object({ id: z.string().min(1).max(120), text: z.string().min(1).max(400) }))
			.min(1)
			.max(20),
	})
	.refine(
		(r) => r.items.reduce((n, item) => n + item.text.length, 0) <= AI_TRANSLATE_MAX_CHARS,
		"Too much text",
	);
export type AiTranslateRequest = z.infer<typeof aiTranslateRequestSchema>;

/** The server checks the id set and `text ≤ 2 × input + 40`; this bounds the shape. */
export const aiTranslateOutputSchema = z.looseObject({
	items: z
		.array(z.looseObject({ id: z.string().min(1).max(120), text: z.string().min(1).max(840) }))
		.max(20),
});
export type AiTranslateOutput = z.infer<typeof aiTranslateOutputSchema>;

/** Remaining AI capacity of the day (requests for suggest, characters for translate). */
export const aiQuotaSchema = z.looseObject({
	limit: z.number().int(),
	remaining: z.number().int(),
	/** Next 00:00 UTC. */
	resetsAt: z.number(),
});
export type AiQuota = z.infer<typeof aiQuotaSchema>;

/*
 * Procedures (spec §4.3, Annex C §1.6). All are POST with a bearer token;
 * content never travels in a URL, and the server neither logs nor caches it.
 */

/**
 * `POST /trpc/ai.setConsent`: the account's AI consent (LGPD art. 8).
 * `suggestions: false` withdraws consent and also turns translation off;
 * `translate` is the separate "translate my content" switch (default off).
 */
export const aiConsentInputSchema = z.object({
	suggestions: z.boolean(),
	translate: z.boolean(),
});
export type AiConsentInput = z.infer<typeof aiConsentInputSchema>;

/** The stored consent, as `AccountInfo.ai` reports it (`consentAt` in epoch ms). */
export const aiConsentSchema = z.looseObject({
	consentAt: z.number().nullable(),
	translate: z.boolean(),
});
export type AiConsent = z.infer<typeof aiConsentSchema>;

/**
 * `ai.suggest` answer. Parse `output` with `aiSuggestOutputSchemas[kind]`
 * (the server already validated and cleaned it); `quota` counts requests.
 */
export const aiSuggestResponseSchema = z.looseObject({
	output: z.unknown(),
	quota: aiQuotaSchema,
});
export type AiSuggestResponse<K extends AiSuggestKind = AiSuggestKind> = {
	output: AiSuggestOutput<K>;
	quota: AiQuota;
};

/**
 * `ai.translate` answer: one item per request item (same ids), and the
 * day's character quota. Each text is at most 2 × its source + 40.
 */
export const aiTranslateResponseSchema = z.looseObject({
	items: aiTranslateOutputSchema.shape.items,
	quota: aiQuotaSchema,
});
export type AiTranslateResponse = z.infer<typeof aiTranslateResponseSchema>;

/**
 * `error.data.atomic.reason` of a refused AI call (Annex C §1.6 "Errors → UI"):
 * - `consent` (412): open the consent dialog (translate: the translate switch is off);
 * - `unverified` (412): email is on and the address isn't confirmed yet;
 * - `quota` (429): today's quota is used up; `retryAt` is the next 00:00 UTC;
 * - `rate` (429): more than 6 calls a minute; `retryAt` says when to try again;
 * - `busy` (503): the model is saturated or the server's daily cap is reached;
 * - `timeout` (504): no answer within `features.ai.timeoutMs`;
 * - `failed` (502): the model failed or gave an unusable answer.
 * Failed, timed-out and busy calls are refunded. AI off answers 501.
 */
export const AI_ERROR_REASONS = [
	"consent",
	"unverified",
	"quota",
	"rate",
	"busy",
	"timeout",
	"failed",
] as const;
export type AiErrorReason = (typeof AI_ERROR_REASONS)[number];
