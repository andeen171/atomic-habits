CREATE TABLE `export_token` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `export_token_token_hash_unique` ON `export_token` (`token_hash`);--> statement-breakpoint
CREATE INDEX `export_token_user_id_idx` ON `export_token` (`user_id`);--> statement-breakpoint
CREATE TABLE `plan_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plan_grant_user_id_idx` ON `plan_grant` (`user_id`);--> statement-breakpoint
CREATE TABLE `subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`plan` text NOT NULL,
	`reference_id` text NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`status` text DEFAULT 'incomplete',
	`period_start` integer,
	`period_end` integer,
	`trial_start` integer,
	`trial_end` integer,
	`cancel_at_period_end` integer DEFAULT false,
	`cancel_at` integer,
	`canceled_at` integer,
	`ended_at` integer,
	`seats` integer,
	`billing_interval` text,
	`stripe_schedule_id` text
);
--> statement-breakpoint
CREATE INDEX `subscription_reference_id_idx` ON `subscription` (`reference_id`);--> statement-breakpoint
CREATE INDEX `subscription_stripe_subscription_id_idx` ON `subscription` (`stripe_subscription_id`);--> statement-breakpoint
CREATE TABLE `blob` (
	`user_id` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`mime` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_seen_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `sha256`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ai_usage` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`translate_chars` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_usage_day_idx` ON `ai_usage` (`day`);--> statement-breakpoint
ALTER TABLE `user` ADD `stripe_customer_id` text;--> statement-breakpoint
ALTER TABLE `user` ADD `ai_consent_at` integer;--> statement-breakpoint
ALTER TABLE `user` ADD `ai_translate` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sync_cursor` ADD `bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Hand-written (drizzle-kit does not model data changes or triggers).
-- Sync quota (spec §4.5): `sync_cursor.bytes` is the UTF-8 size of every stored
-- document of the user. Backfill it, then keep it exact with triggers, which
-- run inside the transaction of the write that changes a document.
UPDATE `sync_cursor` SET `bytes` = (
	SELECT COALESCE(SUM(length(CAST(`data` AS BLOB))), 0) FROM `sync_record`
	WHERE `sync_record`.`user_id` = `sync_cursor`.`user_id`
);--> statement-breakpoint
CREATE TRIGGER `sync_record_bytes_insert` AFTER INSERT ON `sync_record` BEGIN
	UPDATE `sync_cursor` SET `bytes` = `bytes` + length(CAST(NEW.`data` AS BLOB))
	WHERE `user_id` = NEW.`user_id`;
END;--> statement-breakpoint
CREATE TRIGGER `sync_record_bytes_update` AFTER UPDATE OF `data` ON `sync_record` BEGIN
	UPDATE `sync_cursor` SET `bytes` = `bytes` + length(CAST(NEW.`data` AS BLOB)) - length(CAST(OLD.`data` AS BLOB))
	WHERE `user_id` = NEW.`user_id`;
END;--> statement-breakpoint
CREATE TRIGGER `sync_record_bytes_delete` AFTER DELETE ON `sync_record` BEGIN
	UPDATE `sync_cursor` SET `bytes` = `bytes` - length(CAST(OLD.`data` AS BLOB))
	WHERE `user_id` = OLD.`user_id`;
END;
