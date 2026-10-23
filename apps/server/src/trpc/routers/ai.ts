import {
	type AiConsent,
	type AiErrorReason,
	type AiTranslateResponse,
	aiConsentInputSchema,
	aiSuggestRequestSchema,
	aiTranslateRequestSchema,
} from "@atomic/core";
import { TRPCError } from "@trpc/server";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc";
import { eq } from "drizzle-orm";
import { AiError, type AiErrorKind } from "../../ai/provider";
import type { AiService, SuggestResult } from "../../ai/service";
import { user } from "../../db/schema";
import type { Context } from "../context";
import { AtomicCause, enforceRateLimit, protectedProcedure, router } from "../init";

/** Calls per user per minute and procedure (Annex C §6.6 burst limit). */
export const AI_BURST_LIMIT = { max: 6, windowMs: 60_000 } as const;
/** Consent changes per user per minute (cheap, but each one writes). */
export const AI_CONSENT_LIMIT = { max: 30, windowMs: 60_000 } as const;

type Feature = "suggest" | "translate";

function aiOff(): never {
	throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "AI is off on this server" });
}

function refuse(code: TRPC_ERROR_CODE_KEY, reason: AiErrorReason, message: string): never {
	throw new TRPCError({ code, message, cause: new AtomicCause(reason) });
}

/** The service when `feature` is on (`AI_FEATURES`, the kill switch); 501 otherwise. */
function serviceFor(ctx: Context, feature: Feature): AiService {
	const ai = ctx.services.ai;
	if (!ai?.config.features[feature]) aiOff();
	return ai;
}

/**
 * The checks before any quota is touched, in the order of spec §4.5:
 * feature on, consent, verified email (the effective rule, D67), burst
 * limit. They run before the input is parsed, so malformed calls count
 * towards the burst limit too.
 */
function gate(feature: Feature) {
	return protectedProcedure.use(async ({ ctx, next }) => {
		const ai = serviceFor(ctx, feature);
		const [row] = await ctx.services.db
			.select({ consentAt: user.aiConsentAt, translate: user.aiTranslate })
			.from(user)
			.where(eq(user.id, ctx.user.id));
		const consented = Boolean(row?.consentAt) && (feature === "suggest" || Boolean(row?.translate));
		if (!consented) refuse("PRECONDITION_FAILED", "consent", "AI consent is required");
		// Google-verified addresses arrive verified (Better Auth reads `email_verified`).
		if (ai.config.requireVerifiedEmail && !ctx.user.emailVerified) {
			refuse("PRECONDITION_FAILED", "unverified", "Confirm your email first");
		}
		enforceRateLimit(
			ctx,
			`ai.${feature}`,
			ctx.user.id,
			AI_BURST_LIMIT.max,
			AI_BURST_LIMIT.windowMs,
		);
		return next({ ctx: { ai } });
	});
}

const CODES: Record<AiErrorKind, TRPC_ERROR_CODE_KEY> = {
	quota: "TOO_MANY_REQUESTS",
	busy: "SERVICE_UNAVAILABLE",
	timeout: "GATEWAY_TIMEOUT",
	failed: "BAD_GATEWAY",
	invalid: "BAD_GATEWAY",
	aborted: "CLIENT_CLOSED_REQUEST",
};

const REASONS: Record<AiErrorKind, AiErrorReason> = {
	quota: "quota",
	busy: "busy",
	timeout: "timeout",
	failed: "failed",
	invalid: "failed",
	aborted: "failed",
};

const MESSAGES: Record<AiErrorKind, string> = {
	quota: "Today's AI quota is used up",
	busy: "AI is busy right now",
	timeout: "AI took too long",
	failed: "AI couldn't answer",
	invalid: "AI couldn't answer",
	aborted: "Request canceled",
};

/** A pipeline failure as a content-free tRPC error with `data.atomic.reason`. */
function toTrpcError(error: unknown): never {
	if (!(error instanceof AiError)) throw error;
	throw new TRPCError({
		code: CODES[error.kind],
		message: MESSAGES[error.kind],
		cause: new AtomicCause(REASONS[error.kind], error.detail.retryAt),
	});
}

/**
 * `ai.*` (spec §4.3, Annex C §1.6): consent, suggestions and translation.
 * All POST (content never in a URL), 16 KB bodies, answers never cached.
 */
export const aiRouter = router({
	/**
	 * `POST /trpc/ai.setConsent {suggestions, translate}` → `{consentAt, translate}`.
	 * Withdrawing (suggestions: false) also turns translation off. Granting
	 * needs AI to be on; withdrawing always works.
	 */
	setConsent: protectedProcedure
		.input(aiConsentInputSchema)
		.mutation(async ({ ctx, input }): Promise<AiConsent> => {
			const { db, now, config } = ctx.services;
			const on = Boolean(config.ai && (config.ai.features.suggest || config.ai.features.translate));
			if (input.suggestions && !on) aiOff();
			enforceRateLimit(
				ctx,
				"ai.setConsent",
				ctx.user.id,
				AI_CONSENT_LIMIT.max,
				AI_CONSENT_LIMIT.windowMs,
			);
			const [row] = await db
				.select({ consentAt: user.aiConsentAt })
				.from(user)
				.where(eq(user.id, ctx.user.id));
			// Consent keeps the moment it was first given until it is withdrawn.
			const consentAt = input.suggestions ? (row?.consentAt ?? new Date(now())) : null;
			const translate = input.suggestions && input.translate;
			await db
				.update(user)
				.set({ aiConsentAt: consentAt, aiTranslate: translate })
				.where(eq(user.id, ctx.user.id));
			return { consentAt: consentAt?.getTime() ?? null, translate };
		}),

	/** `POST /trpc/ai.suggest {kind, locale, input}` → `{output, quota}`. */
	suggest: gate("suggest")
		.input(aiSuggestRequestSchema)
		.mutation(async ({ ctx, input }): Promise<SuggestResult> => {
			const { limits } = await ctx.services.entitlements.get(ctx.user.id);
			try {
				return await ctx.ai.suggest(input, {
					userId: ctx.user.id,
					limits,
					signal: ctx.signal,
				});
			} catch (error) {
				return toTrpcError(error);
			}
		}),

	/** `POST /trpc/ai.translate {target, items}` → `{items, quota}` (quota in characters). */
	translate: gate("translate")
		.input(aiTranslateRequestSchema)
		.mutation(async ({ ctx, input }): Promise<AiTranslateResponse> => {
			const { limits } = await ctx.services.entitlements.get(ctx.user.id);
			try {
				return await ctx.ai.translate(input, {
					userId: ctx.user.id,
					limits,
					signal: ctx.signal,
				});
			} catch (error) {
				return toTrpcError(error);
			}
		}),
});
