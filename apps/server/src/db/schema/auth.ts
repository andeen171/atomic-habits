import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { nowMs as now } from "./common";

/**
 * Better Auth 1.7 core tables (user, session, account, verification), matching
 * the schema its CLI generates for SQLite. Property names are what Better Auth
 * addresses; column names are snake_case.
 */

const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).default(now).notNull();
const updatedAt = () =>
	integer("updated_at", { mode: "timestamp_ms" })
		.default(now)
		.$onUpdate(() => new Date())
		.notNull();

export const user = sqliteTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
	image: text("image"),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
	/** Stripe plugin field (`@better-auth/stripe`); created lazily at first checkout. */
	stripeCustomerId: text("stripe_customer_id"),
	/** AI consent (Better Auth `additionalFields`, `input: false`): set only by `ai.setConsent`. */
	aiConsentAt: integer("ai_consent_at", { mode: "timestamp_ms" }),
	aiTranslate: integer("ai_translate", { mode: "boolean" }).default(false).notNull(),
});

export const session = sqliteTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		token: text("token").notNull().unique(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = sqliteTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
		refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
		scope: text("scope"),
		password: text("password"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = sqliteTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(table) => [index("verification_identifier_idx").on(table.identifier)],
);
