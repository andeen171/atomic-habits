import type { Plan } from "@atomic/core";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { nowMs } from "./common";

/**
 * The `@better-auth/stripe` 1.7.10 `subscription` model, column for column
 * (the plugin's `subscriptions` schema, which `@better-auth/cli generate`
 * reads). Property names are what the plugin addresses.
 *
 * No foreign key on `referenceId` (spec §4.4): the account purge deletes
 * these rows explicitly after cancelling the Stripe subscription.
 */
export const subscription = sqliteTable(
	"subscription",
	{
		id: text("id").primaryKey(),
		plan: text("plan").notNull(),
		/** The user id (the plugin's reference is the user unless organizations are on). */
		referenceId: text("reference_id").notNull(),
		stripeCustomerId: text("stripe_customer_id"),
		stripeSubscriptionId: text("stripe_subscription_id"),
		status: text("status").default("incomplete"),
		periodStart: integer("period_start", { mode: "timestamp_ms" }),
		periodEnd: integer("period_end", { mode: "timestamp_ms" }),
		trialStart: integer("trial_start", { mode: "timestamp_ms" }),
		trialEnd: integer("trial_end", { mode: "timestamp_ms" }),
		cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" }).default(false),
		cancelAt: integer("cancel_at", { mode: "timestamp_ms" }),
		canceledAt: integer("canceled_at", { mode: "timestamp_ms" }),
		endedAt: integer("ended_at", { mode: "timestamp_ms" }),
		seats: integer("seats"),
		billingInterval: text("billing_interval"),
		stripeScheduleId: text("stripe_schedule_id"),
	},
	(table) => [
		index("subscription_reference_id_idx").on(table.referenceId),
		index("subscription_stripe_subscription_id_idx").on(table.stripeSubscriptionId),
	],
);

/** Plans given by hand (`scripts/grant.ts`), e.g. to beta testers. */
export const planGrant = sqliteTable(
	"plan_grant",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		plan: text("plan").$type<Plan>().notNull(),
		reason: text("reason").notNull(),
		/** Epoch ms. */
		createdAt: integer("created_at").default(nowMs).notNull(),
		/** Epoch ms; null never expires. */
		expiresAt: integer("expires_at"),
	},
	(table) => [index("plan_grant_user_id_idx").on(table.userId)],
);
