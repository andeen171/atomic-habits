import { z } from "zod";
import { isDayKey } from "./dates";

/**
 * Schema primitives shared by the domain model (`model.ts`) and the tracker
 * schemas (`trackers/schema.ts`). They live here, not in `model.ts`, so the
 * tracker schemas can use them without a `model ↔ trackers` import cycle.
 * `model.ts` re-exports everything, so the public API is unchanged.
 *
 * Runtime imports: zod and `dates.ts` only. Keep it that way.
 */

export const dayKeySchema = z.string().refine(isDayKey, "Expected YYYY-MM-DD");
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");
/** Epoch milliseconds; bounded so every store and SQLite reads them back exactly. */
export const timestampSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
/** 0 = Sunday … 6 = Saturday. */
export const weekdaySchema = z.number().int().min(0).max(6);
export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM");

/** Fields every synced document carries (last-write-wins plus a tombstone). */
export const entityFields = {
	id: z.string().min(1).max(80),
	createdAt: timestampSchema,
	updatedAt: timestampSchema,
	deletedAt: timestampSchema.nullable().default(null),
};

export const optionalText = (max: number) => z.string().max(max).nullable().default(null);

/** BCP-47 tag of the text the user typed (set at creation, used by translation). */
export const langField = { lang: z.string().max(10).nullable().default(null) };

/** The book's five cues (ch. 5), shared by the journal (recovery) and the slip tracker. */
export const CUE_TYPES = ["time", "location", "event", "emotion", "people"] as const;
export type CueType = (typeof CUE_TYPES)[number];
