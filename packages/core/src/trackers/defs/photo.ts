import type { AttachmentRef } from "../../attachments";
import type { FieldSpec } from "../forms";
import { TRACKER_META } from "../meta";
import type { TrackerDef } from "../registry";
import { type TrackerConfig, type TrackerEntry, photoTrackerSchema } from "../schema";
import type { GalleryPhoto, SummaryBlock, SummaryContext } from "../summary";
import {
	blocks,
	daysOf,
	firstLine,
	inPeriod,
	line,
	list,
	ofType,
	onThisDay,
	onThisDayLabel,
	stat,
	str,
} from "./kit";

/**
 * `photo`: Photo journal (Annex K §1.8.11 with the spec §2.3 additions;
 * milestone 4C). A day's photos with a caption; `compare` shows the first
 * and the latest photo side by side (progress photo); `photoRequired: false`
 * turns it into a note log with an optional photo (the meal log), which
 * stays usable where photos are unavailable.
 */

type Config = Extract<TrackerConfig, { type: "photo" }>;

/** The entry's photo refs (well-formed objects only). */
export function photosOf(entry: TrackerEntry): AttachmentRef[] {
	const photos = entry.data.photos;
	if (!Array.isArray(photos)) return [];
	return photos.filter(
		(p): p is AttachmentRef =>
			Boolean(p) && typeof p === "object" && typeof (p as { hash?: unknown }).hash === "string",
	);
}

/**
 * Whether new photo entries can't be logged here: the tracker requires a
 * photo and this build has no photos (the artifact). The composer then shows
 * `tracker.photo.requiredOff` instead of fields; existing entries stay
 * editable (their caption).
 */
export function photoLoggingBlocked(
	config: Pick<Config, "photoRequired">,
	caps: { photos: boolean },
): boolean {
	return !caps.photos && config.photoRequired !== false;
}

function galleryOf(entries: readonly TrackerEntry[]): GalleryPhoto[] {
	const out: GalleryPhoto[] = [];
	for (const entry of entries) {
		for (const ref of photosOf(entry)) {
			out.push({ entryId: entry.id, ref, day: entry.date, caption: str(entry.data.caption) });
		}
	}
	return out;
}

function summary(ctx: SummaryContext<Config>): SummaryBlock[] {
	const { config, t } = ctx;
	const entries = inPeriod(ctx, "photo");
	const photos = galleryOf(entries);
	const days = daysOf(entries).size;
	let compare: SummaryBlock | null = null;
	if (config.compare && ctx.caps.photos) {
		// Newest entry first: its first photo is "now"; the oldest entry's first photo is "then".
		const withPhotos = ofType(ctx.all, "photo").filter((e) => photosOf(e).length > 0);
		const newest = withPhotos[0];
		const oldest = withPhotos[withPhotos.length - 1];
		const latest = newest ? galleryOf([newest])[0] : undefined;
		const first = oldest ? galleryOf([oldest])[0] : undefined;
		if (latest && first && latest.ref.hash !== first.ref.hash) {
			compare = {
				kind: "compare",
				id: "compare",
				title: t.t("tracker.photo.compare"),
				before: first,
				after: latest,
			};
		}
	}
	const captions = ctx.caps.photos
		? []
		: entries
				.filter((e) => str(e.data.caption))
				.slice(0, 10)
				.map((e) => ({
					id: e.id,
					entryId: e.id,
					primary: firstLine(str(e.data.caption), 120) as string,
					secondary: t.formatDayShort(e.date),
				}));
	const memories = onThisDay(ofType(ctx.all, "photo"), ctx.today).map(({ entry, ago }) => ({
		id: `otd:${entry.id}`,
		entryId: entry.id,
		primary: firstLine(str(entry.data.caption)) ?? t.formatDayShort(entry.date),
		secondary: onThisDayLabel(ago, t),
	}));
	// A meal log counts days logged; photos are counted where there are any to show.
	const optional = config.photoRequired === false;
	return blocks(
		{
			kind: "stats",
			id: "stats",
			items: [
				stat(
					"days",
					t.t(optional ? "tracker.photo.daysLogged" : "tracker.photo.days"),
					t.number(days),
					days,
				),
				...(ctx.caps.photos && (!optional || photos.length > 0)
					? [stat("photos", t.t("tracker.photo.count"), t.number(photos.length), photos.length)]
					: []),
			],
		},
		compare,
		ctx.caps.photos &&
			photos.length > 0 && {
				kind: "gallery",
				id: "gallery",
				title: t.t("tracker.photo.gallery"),
				photos,
			},
		list("notes", t.t("tracker.photo.notes"), captions),
		memories.length > 0 && list("onThisDay", t.t("tracker.onThisDay"), memories),
	);
}

export const photoDef: TrackerDef<Config> = {
	...TRACKER_META.photo,
	emoji: "📸",
	primaryType: "photo",
	defaults: () => photoTrackerSchema.parse({ type: "photo" }) as Config,

	form(type, ctx) {
		if (type !== "photo") return [];
		const { config, t } = ctx;
		const required = config.photoRequired !== false;
		const editing = Boolean(ctx.entryId);
		// A required photo can't be taken here: nothing to log (editing keeps the caption).
		if (photoLoggingBlocked(config, ctx.caps) && !editing) return [];
		// Without photos the caption carries the entry; a meal log needs one or the other.
		const group =
			ctx.caps.photos && !required
				? { group: { id: "content", message: t.t("tracker.photoNeedsCaption") } }
				: {};
		const specs: FieldSpec[] = [];
		if (ctx.caps.photos) {
			specs.push({
				key: "photos",
				kind: "photos",
				label: t.t("tracker.photos"),
				section: "primary",
				required,
				max: 4,
				...group,
			});
		}
		specs.push({
			key: "caption",
			kind: "longtext",
			label: t.t("tracker.photo.caption"),
			placeholder: config.prompt ?? t.t("tracker.photo.captionPlaceholder"),
			section: "primary",
			// Without photos the caption is the entry (meal log); editing a photo entry keeps it optional.
			required: !ctx.caps.photos && !required,
			max: 280,
			...group,
		});
		return specs;
	},

	draft: () => ({}),

	dayLine({ entries, t }) {
		const logged = ofType(entries, "photo");
		const first = logged[0];
		if (!first) return null;
		const caption = firstLine(str(first.data.caption));
		const count = logged.reduce((acc, e) => acc + photosOf(e).length, 0);
		if (caption) return caption;
		return count > 0 ? t.tp("tracker.photo.photos", count) : null;
	},

	entryLine(entry, { t }) {
		const count = photosOf(entry).length;
		return line(
			firstLine(str(entry.data.caption)) ?? t.t("tracker.entryType.photo"),
			count > 0 ? t.tp("tracker.photo.photos", count) : null,
			entry,
		);
	},

	summary,

	headline(ctx) {
		const days = daysOf(inPeriod(ctx, "photo")).size;
		if (days === 0) return null;
		const key =
			ctx.config.photoRequired === false
				? "tracker.photo.headlineLogged"
				: "tracker.photo.headline";
		return ctx.t.tp(key, days);
	},
};
