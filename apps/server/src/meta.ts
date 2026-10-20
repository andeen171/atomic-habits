import {
	ATTACHMENT_MIMES,
	COLLECTIONS,
	type Offer,
	SCHEMA_REV,
	SERVER_API_VERSION,
	type ServerInfo,
} from "@atomic/core";
import type { Config } from "./config";
import { type Logger, safeTag } from "./lib/log";
import { SERVER_VERSION } from "./version";

/**
 * The capability handshake, `GET /trpc/meta` (spec §2.7, §4.3, D3, D49):
 * protocol and schema revision, the collections this server stores, the
 * optional features that are on, the latest sideloaded clients and the legal
 * links. Clients cache it for an hour, so feature switches (including the
 * `AI_FEATURES=` kill switch) reach them within that hour.
 */

/** Builds `ServerInfo` from the configuration and the current offers (pure). */
export function buildServerInfo(config: Config, offers: readonly Offer[]): ServerInfo {
	const ai = config.ai;
	const aiOn = ai !== null && (ai.features.suggest || ai.features.translate);
	return {
		api: SERVER_API_VERSION,
		version: SERVER_VERSION,
		schemaRev: SCHEMA_REV,
		collections: [...COLLECTIONS],
		clients: { android: config.android ? { ...config.android } : null },
		features: {
			email: config.email !== null,
			google: config.google
				? { webClientId: config.google.webClientId, webOrigins: [...config.google.webOrigins] }
				: null,
			billing: config.billing
				? { provider: "stripe", offers: [...offers], trialDays: config.billing.trialDays }
				: null,
			ai: aiOn
				? {
						suggest: ai.features.suggest,
						translate: ai.features.translate,
						hosting: ai.hosting,
						providerName: ai.providerName,
						requiresVerifiedEmail: ai.requireVerifiedEmail,
						limits: { ...config.plans.limits },
						beta: true,
						timeoutMs: ai.timeoutMs,
					}
				: null,
			blobs: config.blobs
				? { maxFileBytes: config.blobMaxFileBytes, mimes: [...ATTACHMENT_MIMES] }
				: null,
		},
		legal: { ...config.legal },
	};
}

/** Offers are cached this long (Stripe prices rarely change). */
export const OFFERS_TTL_MS = 60 * 60 * 1000;
/** After a failed lookup, serve no offers for this long before trying again. */
export const OFFERS_RETRY_MS = 5 * 60 * 1000;

export interface MetaService {
	info(): Promise<ServerInfo>;
}

export function createMeta(deps: {
	config: Config;
	now: () => number;
	log: Logger;
	/** The billing provider's offers (milestone C); none while billing is off. */
	offers?: () => Promise<Offer[]>;
}): MetaService {
	const { config, now, log } = deps;
	let cached: { offers: Offer[]; until: number } | null = null;
	let inflight: Promise<Offer[]> | null = null;

	const offers = async (): Promise<Offer[]> => {
		if (!config.billing || !deps.offers) return [];
		const at = now();
		if (cached && at < cached.until) return cached.offers;
		inflight ??= deps
			.offers()
			.then((list) => {
				cached = { offers: list, until: now() + OFFERS_TTL_MS };
				return list;
			})
			.catch((error: unknown) => {
				// Empty offers rather than a failing handshake; never the error object.
				log.warn({
					msg: "billing.offers",
					outcome: "failed",
					cause: safeTag((error as Error)?.name),
				});
				cached = { offers: [], until: now() + OFFERS_RETRY_MS };
				return [];
			})
			.finally(() => {
				inflight = null;
			});
		return inflight;
	};

	return {
		async info() {
			return buildServerInfo(config, await offers());
		},
	};
}
