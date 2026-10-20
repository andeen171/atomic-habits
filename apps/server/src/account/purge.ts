import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import type { EntitlementService } from "../billing/entitlements";
import type { BillingProvider } from "../billing/provider";
import type { BlobService } from "../blobs/service";
import type { Database } from "../db";
import { subscription, user, verification } from "../db/schema";
import { type Logger, safeTag } from "../lib/log";

/**
 * Account erasure (LGPD art. 18 VI; spec §4.5, Annex C §1.1). Better Auth's
 * `/delete-user` runs this as `beforeDelete`, then deletes the user row; the
 * database cascades remove everything else that hangs off it (`sync_record`,
 * `sync_cursor`, `blob` rows, `ai_usage`, `plan_grant`, `export_token`,
 * `session`, `account`).
 *
 * Order:
 * 1. cancel every live subscription immediately (through the billing
 *    provider); a failure aborts the whole deletion with 502
 *    (`account.errors.deleteBilling`): a paying user must never lose the
 *    account while Stripe keeps charging;
 * 2. delete the provider's customer (best effort; Stripe keeps invoices by law);
 * 3. delete every photo object, under the user's blob lock, after which the
 *    account takes no more uploads (a failure aborts with 503: rows without
 *    objects can be retried, objects without rows would be orphaned forever);
 * 4. delete the subscription rows (no foreign key) and stray reset tokens.
 *
 * Every step is idempotent, so a retry after an abort completes the erasure.
 * Logs name the step and outcome only.
 */

/** Subscriptions Stripe may still charge for. */
const ENDED = new Set(["canceled", "incomplete_expired"]);

export interface PurgeDeps {
	db: Database;
	/** Null when billing is off. */
	billing: BillingProvider | null;
	/** Null when photo backup is off. */
	blobs: BlobService | null;
	entitlements: EntitlementService;
	log: Logger;
}

export type PurgeUser = (userId: string) => Promise<void>;

export function createPurge(deps: PurgeDeps): PurgeUser {
	const { db, billing, blobs, log } = deps;
	const step = (name: string, outcome: string, cause?: unknown) =>
		(outcome === "failed" ? log.warn : log.info)({
			msg: "purge",
			step: name,
			outcome,
			cause: cause === undefined ? undefined : safeTag((cause as Error)?.name ?? typeof cause),
		});

	return async (userId) => {
		const subscriptions = await db
			.select({ stripeId: subscription.stripeSubscriptionId, status: subscription.status })
			.from(subscription)
			.where(eq(subscription.referenceId, userId));
		const live = subscriptions.filter((s) => s.stripeId && !ENDED.has(s.status ?? ""));
		if (live.length && !billing) {
			// Billing was switched off since: nothing can cancel them from here.
			step("billing.cancel", "skipped");
		}
		if (billing) {
			for (const { stripeId } of live) {
				try {
					// Already gone at the provider counts as done.
					await billing.cancelImmediately(stripeId as string);
				} catch (error) {
					step("billing.cancel", "failed", error);
					throw new APIError("BAD_GATEWAY", {
						message: "Couldn't cancel the subscription; nothing was deleted",
						code: "BILLING_CANCEL_FAILED",
					});
				}
			}
			const [row] = await db
				.select({ customer: user.stripeCustomerId })
				.from(user)
				.where(eq(user.id, userId));
			if (row?.customer) {
				try {
					await billing.deleteCustomer(row.customer);
				} catch (error) {
					step("billing.customer", "failed", error);
				}
			}
		}

		if (blobs) {
			try {
				await blobs.purgeUser(userId);
			} catch (error) {
				step("blobs", "failed", error);
				throw new APIError("SERVICE_UNAVAILABLE", {
					message: "Couldn't delete the photos; try again",
					code: "PURGE_BLOBS_FAILED",
				});
			}
		}

		await db.delete(subscription).where(eq(subscription.referenceId, userId));
		// Pending password-reset tokens point at the user id.
		await db.delete(verification).where(eq(verification.value, userId));
		deps.entitlements.invalidate(userId);
		step("all", "done");
	};
}
