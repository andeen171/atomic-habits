import { z } from "zod";
import { ATTACHMENT_MIMES, SHA256_RE } from "./attachments";

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
	/** The same for `ai.translate` (`AI_TRANSLATE_TIMEOUT_MS`); absent: use `timeoutMs`. */
	translateTimeoutMs: z.number().int().optional(),
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

/*
 * Photo backup (spec §4.3, D23), on when `ServerInfo.features.blobs` is set.
 * Blobs are content-addressed per account (lowercase hex SHA-256 of the
 * bytes); JPEG and WebP only, at most `features.blobs.maxFileBytes` each.
 *
 * - `POST /trpc/blobs.missing {hashes}` → `{missing}`: which of these the
 *   server doesn't hold for this account (in request order, no repeats).
 * - `PUT /blobs/<sha256>` with the raw bytes → 201 (stored) or 200 (already
 *   there; only its last-seen time moves). 120 per minute per account.
 * - `GET /blobs/<sha256>` → the bytes, for the account's own blobs only
 *   (404 otherwise); immutable, cache privately forever.
 *
 * A refused PUT answers JSON `{message, code}` with a `BLOB_ERROR_CODES` code.
 * Photo backup off answers 501 everywhere (`code: "BLOBS_DISABLED"` on the
 * REST routes, `NOT_IMPLEMENTED` on `blobs.missing`).
 */

/** Hashes per `blobs.missing` call. */
export const BLOBS_MISSING_MAX = 500;

export const blobsMissingInputSchema = z.object({
	hashes: z.array(z.string().regex(SHA256_RE)).max(BLOBS_MISSING_MAX),
});
export type BlobsMissingInput = z.infer<typeof blobsMissingInputSchema>;

export const blobsMissingSchema = z.looseObject({ missing: z.array(z.string()) });
export type BlobsMissing = z.infer<typeof blobsMissingSchema>;

/** A successful `PUT /blobs/<sha256>`. */
export const blobUploadSchema = z.looseObject({
	sha256: z.string(),
	size: z.number().int(),
	mime: z.enum(ATTACHMENT_MIMES),
	/** False when the server already had it (idempotent re-upload). */
	created: z.boolean(),
});
export type BlobUpload = z.infer<typeof blobUploadSchema>;

/**
 * `code` of a refused `PUT /blobs/<sha256>`:
 * - `INVALID_HASH` (400): the path isn't a lowercase hex SHA-256;
 * - `HASH_MISMATCH` (400): the bytes don't hash to the path (corrupted upload; retry);
 * - `TOO_LARGE` (413): over `features.blobs.maxFileBytes` (never retry);
 * - `UNSUPPORTED_TYPE` (415): not JPEG or WebP by its first bytes (never retry);
 * - `QUOTA_EXCEEDED` (413): the plan's photo storage is full (`plan.storageFull`;
 *   stop uploading, keep the photo on the device);
 * - `BLOBS_DISABLED` (501): photo backup is off on this server.
 * Any other 413 (a proxy's) counts as `TOO_LARGE`. 429 carries `Retry-After`.
 */
export const BLOB_ERROR_CODES = [
	"INVALID_HASH",
	"HASH_MISMATCH",
	"TOO_LARGE",
	"UNSUPPORTED_TYPE",
	"QUOTA_EXCEEDED",
	"BLOBS_DISABLED",
] as const;
export type BlobErrorCode = (typeof BLOB_ERROR_CODES)[number];

/*
 * Billing (spec §4.3, Annex C §1.5). Clients never talk to Stripe-specific
 * routes: `billing.checkout` and `billing.portal` return a URL to open, and
 * Stripe sends the browser back to the server's `/billing/return` page,
 * which hands over to the app by client kind.
 */

export const BILLING_INTERVALS = ["month", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** Who opened checkout: decides where `/billing/return` sends the browser. */
export const BILLING_CLIENTS = ["web", "desktop", "native"] as const;
export type BillingClient = (typeof BILLING_CLIENTS)[number];

/** How the browser came back: paid, gave up, or left the billing portal. */
export const BILLING_RESULTS = ["success", "cancel", "portal"] as const;
export type BillingResult = (typeof BILLING_RESULTS)[number];

/**
 * Native: `/billing/return` opens `atomic://billing?result=<BillingResult>`;
 * pass it to `WebBrowser.openAuthSessionAsync(url, BILLING_DEEP_LINK)`.
 */
export const BILLING_DEEP_LINK = "atomic://billing";

/**
 * Web: `/billing/return` redirects to `returnTo` with this query parameter
 * added (inside the hash for hash routes: `…/#/account?billing=success`).
 * `returnTo` must be on an `APP_WEB_URL` origin.
 */
export const BILLING_RESULT_PARAM = "billing";

/** `POST /trpc/billing.checkout`. */
export const billingCheckoutInputSchema = z.object({
	interval: z.enum(BILLING_INTERVALS),
	client: z.enum(BILLING_CLIENTS),
	/** Web only: where to land afterwards (an `APP_WEB_URL` origin; ignored otherwise). */
	returnTo: z.string().max(2048).optional(),
});
export type BillingCheckoutInput = z.infer<typeof billingCheckoutInputSchema>;

/** `POST /trpc/billing.portal`. */
export const billingPortalInputSchema = z.object({
	client: z.enum(BILLING_CLIENTS),
	returnTo: z.string().max(2048).optional(),
});
export type BillingPortalInput = z.infer<typeof billingPortalInputSchema>;

/** Both billing procedures answer with the page to open. */
export const billingUrlSchema = z.looseObject({ url: z.string().url() });
export type BillingUrl = z.infer<typeof billingUrlSchema>;

/**
 * `error.data.atomic.reason` of a refused billing call:
 * - `unverified` (412): email is on and the address isn't confirmed yet;
 * - `no-customer` (412): the portal needs a past checkout (`canManageBilling`);
 * - `already-subscribed` (409): this plan and interval are already active;
 * - `interval-unavailable` (400): the server sells no yearly plan.
 * Billing off answers `NOT_IMPLEMENTED` (501); a Stripe outage `BAD_GATEWAY` (502).
 */
export const BILLING_ERROR_REASONS = [
	"unverified",
	"no-customer",
	"already-subscribed",
	"interval-unavailable",
] as const;
export type BillingErrorReason = (typeof BILLING_ERROR_REASONS)[number];

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
