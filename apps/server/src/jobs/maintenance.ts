import type { BlobService, GcSummary } from "../blobs/service";
import { type Logger, safeTag } from "../lib/log";

/**
 * Hourly housekeeping (spec §4.5), in this process: run ONE instance per
 * database, or two processes would GC the same users.
 *
 * Today: the blob GC (`BlobService.gcDue`, each user at most once a day,
 * 7-day grace, rows before objects, under the per-user lock). Milestone F
 * adds pruning `ai_usage` older than 40 days, pruning expired `export_token`
 * rows and the throttled Stripe reconciliation to the same pass.
 *
 * Passes never overlap; a failing step is logged (content-free) and the
 * next pass tries again.
 */

export const MAINTENANCE_EVERY_MS = 60 * 60_000;
/** The first pass waits a little, so a crash loop doesn't run it on every boot. */
export const MAINTENANCE_FIRST_MS = 5 * 60_000;

export interface MaintenanceReport {
	/** Null when photo backup is off or the step failed. */
	blobs: GcSummary | null;
}

export interface Maintenance {
	/** One pass now (joins a running one). */
	runOnce(): Promise<MaintenanceReport>;
	/** Schedules the hourly passes; the timer never keeps the process alive. */
	start(): void;
	stop(): void;
}

export interface MaintenanceDeps {
	blobs: BlobService | null;
	log: Logger;
	everyMs?: number;
	firstMs?: number;
}

export function createMaintenance(deps: MaintenanceDeps): Maintenance {
	const { log } = deps;
	const everyMs = deps.everyMs ?? MAINTENANCE_EVERY_MS;
	const firstMs = deps.firstMs ?? MAINTENANCE_FIRST_MS;
	let running: Promise<MaintenanceReport> | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let active = false;

	const step = async <T>(name: string, run: () => Promise<T>): Promise<T | null> => {
		try {
			return await run();
		} catch (error) {
			log.error({
				msg: "maintenance",
				step: name,
				outcome: "failed",
				cause: safeTag((error as Error)?.name ?? typeof error),
			});
			return null;
		}
	};

	const runOnce = (): Promise<MaintenanceReport> => {
		running ??= (async () => {
			try {
				const blobs = deps.blobs;
				return { blobs: blobs ? await step("blobs.gc", () => blobs.gcDue()) : null };
			} finally {
				running = null;
			}
		})();
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
