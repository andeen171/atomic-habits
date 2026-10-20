import type { Plan, PlanLimits } from "@atomic/core";
import type { Config } from "../config";

/** The configured limits of a plan (`LIMIT_*`, `BLOB_MAX_FILE_BYTES`). */
export function planLimits(config: Pick<Config, "plans">, plan: Plan): PlanLimits {
	return config.plans.limits[plan];
}
