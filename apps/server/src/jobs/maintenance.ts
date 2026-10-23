import { utcDay } from "../account/usage";
import type { BillingProvider } from "../billing/provider";
import type { BlobService, GcSummary } from "../blobs/service";
import type { Database } from "../db";
import { type Logger, safeTag } from "../lib/log";
import { type Metrics, noopMetrics } from "../ops/metrics";

/**
 * Hourly housekeeping (spec §4.5), in this process: run ONE instance per
 * database, or two processes would GC the same users. Each pass runs these
 * steps in order; a failing step is logged (content-free), counted
 * (`atomic_maintenance_steps_total{step,outcome}`) and retried next pass:
 *
 * 1. `ai_usage.prune`: AI usage rows older than `AI_USAGE_KEEP_DAYS` (40).
 * 2. `export_token.prune`: export links that were used or expired.
 * 3. `auth.prune`: expired sessions (their device label and IP go with
 *    them) and expired verification tokens (reset, email confirmation).
 * 4. `blobs.gc`: the photo GC (`BlobService.gcDue`, each user at most once
 *    a day, 7-day grace, rows before objects, under the per-user lock).
 * 5. `billing.reconcile`: the throttled Stripe reconciliation
 *    (`BillingProvider.reconcileStale`, at most 20 Stripe lookups a pass).
 *
 * Passes never overlap. One `maintenance` line per pass reports counts.
 */

export const MAINTENANCE_EVERY_MS = 60 * 60_000;
/** The first pass waits a little, so a crash loop doesn't run it on every boot. */
export const MAINTENANCE_FIRST_MS = 5 * 60_000;
/** AI usage is kept this many days (the account page shows today; the rest is capacity planning). */
export const AI_USAGE_KEEP_DAYS = 40;

const DAY_MS = 86_400_000;

export interface MaintenanceReport {
	/** Rows pruned; null when the step failed. */
	aiUsage: number | null;
	exportTokens: number | null;
	/** Expired sessions and verification rows pruned; null when the step failed. */
	auth: number | null;
	/** Null when photo backup is off or the step failed. */
	blobs: GcSummary | null;
	/** Subscription rows refreshed from Stripe; null when billing is off or the step failed. */
	billing: number | null;
}

export interface Maintenance {
	/** One pass now (joins a running one). */
	runOnce(): Promise<MaintenanceReport>;
	/** Schedules the hourly passes; the timer never keeps the process alive. */
	start(): void;
	stop(): void;
}

export interface MaintenanceDeps {
	db: Database;
	blobs: BlobService | null;
	billing: BillingProvider | null;
	log: Logger;
	metrics?: Metrics;
	now: () => number;
	everyMs?: number;
	firstMs?: number;
}

const rowsAffected = (result: { rowsAffected: number }) => result.rowsAffected;

export function createMaintenance(deps: MaintenanceDeps): Maintenance {
	const { db, log, now } = deps;
	const metrics = deps.metrics ?? noopMetrics;
	const everyMs = deps.everyMs ?? MAINTENANCE_EVERY_MS;
	const firstMs = deps.firstMs ?? MAINTENANCE_FIRST_MS;
	let running: Promise<MaintenanceReport> | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let active = false;

	const step = async <T>(name: string, run: () => Promise<T>): Promise<T | null> => {
		try {
			const result = await run();
			metrics.maintenance(name, "ok");
			return result;
		} catch (error) {
			metrics.maintenance(name, "failed");
			log.error({
				msg: "maintenance",
				step: name,
				outcome: "failed",
				cause: safeTag((error as Error)?.name ?? typeof error),
			});
			return null;
		}
	};

	const pass = async (): Promise<MaintenanceReport> => {
		const started = performance.now();
		const at = now();
		const aiUsage = await step("ai_usage.prune", async () =>
			rowsAffected(
				await db.$client.execute({
					sql: "DELETE FROM ai_usage WHERE day < :cutoff",
					args: { ":cutoff": utcDay(at - AI_USAGE_KEEP_DAYS * DAY_MS) },
				}),
			),
		);
		const exportTokens = await step("export_token.prune", async () =>
			rowsAffected(
				await db.$client.execute({
					sql: "DELETE FROM export_token WHERE used_at IS NOT NULL OR expires_at <= :now",
					args: { ":now": at },
				}),
			),
		);
		const auth = await step("auth.prune", async () => {
			const sessions = await db.$client.execute({
				sql: "DELETE FROM session WHERE expires_at <= :now",
				args: { ":now": at },
			});
			const verifications = await db.$client.execute({
				sql: "DELETE FROM verification WHERE expires_at <= :now",
				args: { ":now": at },
			});
			return rowsAffected(sessions) + rowsAffected(verifications);
		});
		const blobs = deps.blobs;
		const gc = blobs ? await step("blobs.gc", () => blobs.gcDue()) : null;
		const billing = deps.billing;
		const reconcileStale = billing?.reconcileStale?.bind(billing);
		const reconciled = reconcileStale
			? await step("billing.reconcile", () => reconcileStale())
			: null;
		log.info({
			msg: "maintenance",
			outcome: "done",
			aiUsage: aiUsage ?? undefined,
			exportTokens: exportTokens ?? undefined,
			auth: auth ?? undefined,
			gcUsers: gc?.users,
			gcDeleted: gc?.deleted,
			reconciled: reconciled ?? undefined,
			ms: Math.round(performance.now() - started),
		});
		return { aiUsage, exportTokens, auth, blobs: gc, billing: reconciled };
	};

	const runOnce = (): Promise<MaintenanceReport> => {
		running ??= pass().finally(() => {
			running = null;
		});
		return running;
	};

	const schedule = (ms: number) => {
		timer = setTimeout(async () => {
			await runOnce();
			if (active) schedule(everyMs);
		}, ms);
		(timer as { unref?: () => void }).unref?.();
	};

	return {
		runOnce,
		start() {
			if (active) return;
			active = true;
			schedule(firstMs);
		},
		stop() {
			active = false;
			if (timer) clearTimeout(timer);
			timer = null;
		},
	};
}
