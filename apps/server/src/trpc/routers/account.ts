import type { AccountInfo, ExportLink, RevokeResult, SessionInfo } from "@atomic/core";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { EXPORT_LINK_LIMIT, createExportLink } from "../../account/export";
import { listSessions, revokeOtherSessions, revokeSession } from "../../account/sessions";
import { getUsage } from "../../account/usage";
import { account, user } from "../../db/schema";
import { enforceRateLimit, protectedProcedure, router } from "../init";

/**
 * `account.*` (spec §4.3): the signed-in user's account, devices and data
 * export. Sessions are ids only (never tokens or IPs); deleting the account
 * and changing the password stay on Better Auth (`/delete-user`,
 * `/change-password`).
 */
export const accountRouter = router({
	/** `GET /trpc/account.get`: profile, sign-in methods, AI consent, plan and usage. */
	get: protectedProcedure.query(async ({ ctx }): Promise<AccountInfo> => {
		const { db, entitlements, now } = ctx.services;
		const userId = ctx.user.id;
		const [row] = await db.select().from(user).where(eq(user.id, userId));
		if (!row) throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
		const methods = await db
			.select({ providerId: account.providerId, password: account.password })
			.from(account)
			.where(eq(account.userId, userId));
		const [plan, usage] = await Promise.all([
			entitlements.get(userId),
			getUsage(db, userId, now()),
		]);
		return {
			id: row.id,
			email: row.email,
			name: row.name,
			emailVerified: row.emailVerified,
			createdAt: row.createdAt.getTime(),
			providers: [...new Set(methods.map((m) => m.providerId))].sort(),
			hasPassword: methods.some((m) => m.providerId === "credential" && Boolean(m.password)),
			ai: { consentAt: row.aiConsentAt?.getTime() ?? null, translate: row.aiTranslate },
			entitlements: plan,
			usage,
		};
	}),

	/** `GET /trpc/account.sessions`: signed-in devices, the current one first. */
	sessions: protectedProcedure.query(
		({ ctx }): Promise<SessionInfo[]> =>
			listSessions(ctx.services.db, ctx.user.id, ctx.session.session.id, ctx.services.now()),
	),

	/** `POST /trpc/account.revokeSession {id}`: sign one device out. */
	revokeSession: protectedProcedure.input(z.object({ id: z.string().min(1).max(200) })).mutation(
		async ({ ctx, input }): Promise<RevokeResult> => ({
			revoked: await revokeSession(ctx.services.db, ctx.user.id, input.id),
		}),
	),

	/** `POST /trpc/account.revokeOtherSessions`: every device but this one. */
	revokeOtherSessions: protectedProcedure.mutation(
		async ({ ctx }): Promise<RevokeResult> => ({
			revoked: await revokeOtherSessions(ctx.services.db, ctx.user.id, ctx.session.session.id),
		}),
	),

	/** `POST /trpc/account.exportLink`: a single-use, 10-minute download link (3/hour). */
	exportLink: protectedProcedure
		.use(({ ctx, next }) => {
			enforceRateLimit(
				ctx,
				"account.exportLink",
				ctx.user.id,
				EXPORT_LINK_LIMIT.max,
				EXPORT_LINK_LIMIT.windowMs,
			);
			return next();
		})
		.mutation(
			({ ctx }): Promise<ExportLink> =>
				createExportLink(ctx.services.db, ctx.user.id, ctx.baseUrl, ctx.services.now()),
		),
});
