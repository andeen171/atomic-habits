import { z } from "zod";
import { ATTACHMENT_MIMES } from "./attachments";

/**
 * Account, plan and server-capability contracts shared by the client (T5)
 * and the server (T6) (Annex C §2.5 as amended by spec §3.1).
 *
 * Every schema the client uses to parse a server response is a
 * `z.looseObject`, so a newer server's extra fields never break an older
 * client. Plan limits are keyed by plan name loosely for the same reason.
 *
 * Runtime imports: zod and `attachments.ts` only (React-free; the server
 * imports this module).
 */

/** Bumped when the HTTP/tRPC surface changes incompatibly. */
export const SERVER_API_VERSION = 2;

export const PLANS = ["free", "pro"] as const;
export type Plan = (typeof PLANS)[number];

export const planLimitsSchema = z.looseObject({
	aiRequestsPerDay: z.number().int(),
	aiTranslateCharsPerDay: z.number().int(),
	blobBytes: z.number().int(),
	blobMaxFileBytes: z.number().int(),
	/** Per-user sync storage (spec §4.5). */
	syncBytes: z.number().int(),
});
export type PlanLimits = z.infer<typeof planLimitsSchema>;

export const offerSchema = z.looseObject({
	interval: z.enum(["month", "year"]),
	/** Minor units. */
	amount: z.number().int(),
	currency: z.string().length(3),
});
export type Offer = z.infer<typeof offerSchema>;

const googleFeatureSchema = z.looseObject({
	webClientId: z.string(),
	webOrigins: z.array(z.string()),
});

const billingFeatureSchema = z.looseObject({
	provider: z.string(),
	offers: z.array(offerSchema),
	trialDays: z.number().int(),
});

const aiFeatureSchema = z.looseObject({
	suggest: z.boolean(),
	translate: z.boolean(),
	/** "self-hosted" | "hosted" (shown in the consent text). */
	hosting: z.string(),
	providerName: z.string().nullable(),
	requiresVerifiedEmail: z.boolean(),
	/** Limits per plan name. */
	limits: z.record(z.string().max(20), planLimitsSchema),
	/** Every AI surface carries a "Beta" badge while this is on (D31). */
	beta: z.boolean().default(true),
	/** The server's end-to-end deadline; the client waits `timeoutMs + 5 s`. */
	timeoutMs: z.number().int(),
});

const blobsFeatureSchema = z.looseObject({
	maxFileBytes: z.number().int(),
	mimes: z.array(z.enum(ATTACHMENT_MIMES)),
});

/** `GET /trpc/meta` (public). A 404 means a v1 server (spec §2.7). */
export const serverInfoSchema = z.looseObject({
	api: z.number().int(),
	version: z.string().max(40),
	/** The server's SCHEMA_REV; `invalid` rejections stay pending while it is below the client's. */
	schemaRev: z.number().int().default(1),
	collections: z.array(z.string().max(40)).max(64),
	/** Latest sideloaded native builds ("Update available" banner). */
	clients: z
		.looseObject({
			android: z
				.looseObject({ version: z.string().max(20), url: z.string().url() })
				.nullable()
				.default(null),
		})
		.default({ android: null }),
	features: z.looseObject({
		email: z.boolean().default(false),
		google: googleFeatureSchema.nullable().default(null),
		billing: billingFeatureSchema.nullable().default(null),
		ai: aiFeatureSchema.nullable().default(null),
		blobs: blobsFeatureSchema.nullable().default(null),
	}),
	legal: z
		.looseObject({ privacyUrl: z.string().nullable(), termsUrl: z.string().nullable() })
		.default({ privacyUrl: null, termsUrl: null }),
});
export type ServerInfo = z.infer<typeof serverInfoSchema>;

export const ENTITLEMENT_SOURCES = ["billing-disabled", "stripe", "grant", "none"] as const;
export const ENTITLEMENT_STATUSES = ["active", "trialing", "canceling", "grace", "none"] as const;

export const entitlementsSchema = z.looseObject({
	plan: z.enum(PLANS),
	source: z.enum(ENTITLEMENT_SOURCES),
	status: z.enum(ENTITLEMENT_STATUSES),
	renewsAt: z.number().nullable(),
	endsAt: z.number().nullable(),
	graceUntil: z.number().nullable(),
	limits: planLimitsSchema,
	canManageBilling: z.boolean(),
});
export type Entitlements = z.infer<typeof entitlementsSchema>;

export const usageSchema = z.looseObject({
	aiRequestsToday: z.number().int(),
	aiTranslateCharsToday: z.number().int(),
	/** Next 00:00 UTC. */
	aiResetsAt: z.number(),
	blobBytes: z.number().int(),
	blobCount: z.number().int(),
	/** Bytes of synced documents (spec §4.5 sync quota). */
	syncBytes: z.number().int(),
});
export type Usage = z.infer<typeof usageSchema>;

export const accountInfoSchema = z.looseObject({
	id: z.string(),
	email: z.string(),
	name: z.string(),
	emailVerified: z.boolean(),
	createdAt: z.number(),
	providers: z.array(z.string()),
	hasPassword: z.boolean(),
	ai: z.looseObject({ consentAt: z.number().nullable(), translate: z.boolean() }),
	entitlements: entitlementsSchema,
	usage: usageSchema,
});
export type AccountInfo = z.infer<typeof accountInfoSchema>;

/** A signed-in device. Never carries a token or an IP. */
export const sessionInfoSchema = z.looseObject({
	id: z.string(),
	createdAt: z.number(),
	lastActiveAt: z.number(),
	/** From the `X-Atomic-Device` header at sign-in ("Atomic Android · Pixel 8"). */
	device: z.string().nullable(),
	current: z.boolean(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

/** How long an account export link works (spec §4.3, D69); it also works only once. */
export const EXPORT_LINK_TTL_MS = 10 * 60 * 1000;

/**
 * `POST /trpc/account.exportLink`: a single-use link to the account archive
 * (a ZIP with `export.json`, export v2 plus an `account` block, and the
 * photos of live entries). Open it in a browser or download it directly.
 */
export const exportLinkSchema = z.looseObject({
	url: z.string().url(),
	/** Epoch ms. */
	expiresAt: z.number(),
});
export type ExportLink = z.infer<typeof exportLinkSchema>;

/** `account.revokeSession` / `account.revokeOtherSessions`: how many sessions ended. */
export const revokeResultSchema = z.looseObject({ revoked: z.number().int() });
export type RevokeResult = z.infer<typeof revokeResultSchema>;

/** Stripe's zero-decimal currencies (amounts are whole units). */
const ZERO_DECIMAL = new Set([
	"BIF",
	"CLP",
	"DJF",
	"GNF",
	"JPY",
	"KMF",
	"KRW",
	"MGA",
	"PYG",
	"RWF",
	"UGX",
	"VND",
	"VUV",
	"XAF",
	"XOF",
	"XPF",
]);

/**
 * "R$ 9,90" / "$2.99" for an offer, through `Intl.NumberFormat` (Annex C
 * §3.1); falls back to "BRL 9.90" where Intl lacks currency formatting.
 */
export function formatOffer(offer: Pick<Offer, "amount" | "currency">, locale: string): string {
	const currency = offer.currency.toUpperCase();
	const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
	const value = offer.amount / 10 ** digits;
	try {
		return new Intl.NumberFormat(locale, {
			style: "currency",
			currency,
			minimumFractionDigits: digits,
			maximumFractionDigits: digits,
		}).format(value);
	} catch {
		return `${currency} ${value.toFixed(digits)}`;
	}
}

const DAY_MS = 86_400_000;

/** The next 00:00 UTC strictly after `now` (AI quota reset). */
export function nextUtcMidnight(now: number): number {
	return (Math.floor(now / DAY_MS) + 1) * DAY_MS;
}
