import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
	ATTACHMENT_MIMES,
	type AccountInfo,
	BLOBS_MISSING_MAX,
	type BlobUpload,
	type ServerInfo,
	type WireSyncRecord,
	blobUploadSchema,
	blobsMissingSchema,
} from "@atomic/core";
import { and, eq } from "drizzle-orm";
import {
	BLOBS_MISSING_LIMIT,
	BLOB_GC_GRACE_MS,
	BLOB_PUT_LIMIT,
	type BlobService,
	BlobStorageError,
	collectReferences,
	createBlobService,
} from "../src/blobs/service";
import { sniffImage } from "../src/blobs/sniff";
import {
	type BlobStorage,
	S3_DELETE_CONCURRENCY,
	StorageTimeoutError,
	createDiskStorage,
	createS3Storage,
} from "../src/blobs/storage";
import { blob } from "../src/db/schema";
import { type FakeS3, s3Env, startFakeS3 } from "./fakes";
import {
	BASE_URL,
	type TestServer,
	type TestUser,
	bearer,
	createTestServer,
	postJson,
	pushOk,
	scratchDir,
	signUp,
	trpcData,
} from "./helpers";

/**
 * Photo backup (spec §4.3, §4.5, §4.6, D23): `PUT/GET /blobs/:sha256`,
 * `blobs.missing`, plan quotas, per-user isolation, GC (30-day tombstones,
 * 7-day grace, rows before objects, per-user lock), the purge, and the disk
 * and S3 adapters (against a local fake S3). Nothing touches the network.
 */

const DAY = 86_400_000;
const encoder = new TextEncoder();

/** Bytes a JPEG decoder would recognise by their first marker. */
function jpeg(seed: string, size = 0): Uint8Array<ArrayBuffer> {
	const head = [0xff, 0xd8, 0xff, 0xe0, ...encoder.encode(seed)];
	const out = new Uint8Array(Math.max(size, head.length));
	out.set(head);
	return out;
}

function webp(seed: string): Uint8Array<ArrayBuffer> {
	const body = encoder.encode(`VP8 ${seed}`);
	const out = new Uint8Array(12 + body.length);
	out.set(encoder.encode("RIFF"), 0);
	new DataView(out.buffer).setUint32(4, 4 + body.length, true);
	out.set(encoder.encode("WEBP"), 8);
	out.set(body, 12);
	return out;
}

const png = (seed: string) =>
	new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...encoder.encode(seed)]);

const shaOf = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

function photo(seed: string, kind: "jpeg" | "webp" = "jpeg") {
	const bytes = kind === "jpeg" ? jpeg(seed) : webp(seed);
	return { bytes, sha: shaOf(bytes) };
}

function put(
	server: TestServer,
	token: string | null,
	sha: string,
	body: Uint8Array,
	headers: Record<string, string> = {},
) {
	return server.app.request(`${BASE_URL}/blobs/${sha}`, {
		method: "PUT",
		headers: { "Content-Type": "image/jpeg", ...(token ? bearer(token) : {}), ...headers },
		body: body as Uint8Array<ArrayBuffer>, // test bytes never live in a SharedArrayBuffer
	});
}

function get(
	server: TestServer,
	token: string | null,
	sha: string,
	headers: Record<string, string> = {},
) {
	return server.app.request(`${BASE_URL}/blobs/${sha}`, {
		headers: { ...(token ? bearer(token) : {}), ...headers },
	});
}

async function upload(server: TestServer, token: string, item: { bytes: Uint8Array; sha: string }) {
	const response = await put(server, token, item.sha, item.bytes);
	if (response.status !== 201 && response.status !== 200) {
		throw new Error(`upload failed: ${response.status} ${await response.text()}`);
	}
	return blobUploadSchema.parse(await response.json());
}

const missing = (server: TestServer, token: string | null, hashes: unknown) =>
	postJson(server.app, "/trpc/blobs.missing", { hashes }, token ? bearer(token) : {});

async function refusal(response: Response) {
	return { status: response.status, ...((await response.json()) as { code: string }) };
}

const rows = (server: TestServer, userId: string) =>
	server.db.select().from(blob).where(eq(blob.userId, userId));

const rowOf = async (server: TestServer, userId: string, sha: string) =>
	(
		await server.db
			.select()
			.from(blob)
			.where(and(eq(blob.userId, userId), eq(blob.sha256, sha)))
	)[0] ?? null;

/** A tracker entry holding photo refs (unknown entry types are stored verbatim). */
function photoEntry(
	id: string,
	at: number,
	refs: { hash: string; thumb: string }[],
	options: { deletedAt?: number | null; extra?: Record<string, unknown> } = {},
): WireSyncRecord {
	const deletedAt = options.deletedAt ?? null;
	const updatedAt = deletedAt ?? at;
	return {
		collection: "trackerEntries",
		id,
		updatedAt,
		deletedAt,
		data: {
			id,
			createdAt: at,
			updatedAt,
			deletedAt,
			habitId: "h1",
			date: "2026-10-20",
			type: "x-photo-test",
			at: null,
			data: {
				photos: refs.map((ref) => ({
					...ref,
					mime: "image/jpeg",
					w: 10,
					h: 10,
					bytes: 100,
					alt: null,
				})),
				...options.extra,
			},
		},
	};
}

describe("PUT /blobs/:sha256", () => {
	let server: TestServer;
	let ana: TestUser;

	beforeAll(async () => {
		server = await createTestServer();
		ana = await signUp(server.app, "Ana");
	});

	test("stores a JPEG (201) and a WebP by their sniffed type, under the user", async () => {
		const shot = photo("put-jpeg");
		const response = await put(server, ana.token, shot.sha, shot.bytes);
		expect(response.status).toBe(201);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(blobUploadSchema.parse(await response.json())).toEqual({
			sha256: shot.sha,
			size: shot.bytes.length,
			mime: "image/jpeg",
			created: true,
		});

		// The declared type is never trusted: WebP bytes sent as image/jpeg are WebP.
		const pic = photo("put-webp", "webp");
		expect((await upload(server, ana.token, pic)).mime).toBe("image/webp");
		expect(await rowOf(server, ana.user.id, pic.sha)).toMatchObject({
			mime: "image/webp",
			size: pic.bytes.length,
		});

		// Per-user layout on disk: <BLOB_DIR>/<userId>/<sha[0:2]>/<sha>, no temp files.
		const root = server.config.blobs?.storage === "disk" ? server.config.blobs.dir : "";
		const files = readdirSync(join(root, ana.user.id, shot.sha.slice(0, 2)));
		expect(files).toContain(shot.sha);
		expect(files.some((name) => name.includes(".tmp-"))).toBe(false);
	});

	test("needs a session", async () => {
		const shot = photo("no-auth");
		expect(await refusal(await put(server, null, shot.sha, shot.bytes))).toMatchObject({
			status: 401,
			code: "UNAUTHORIZED",
		});
		expect((await put(server, "not-a-token", shot.sha, shot.bytes)).status).toBe(401);
		expect(await rowOf(server, ana.user.id, shot.sha)).toBeNull();
	});

	test("a path that isn't a lowercase SHA-256 is 400 before any storage path exists", async () => {
		const shot = photo("bad-path");
		for (const bad of [shot.sha.toUpperCase(), shot.sha.slice(1), `${shot.sha}0`, "..%2F..%2Fx"]) {
			expect(await refusal(await put(server, ana.token, bad, shot.bytes))).toMatchObject({
				status: 400,
				code: "INVALID_HASH",
			});
		}
		// Nothing was written outside the user's folders.
		const root = server.config.blobs?.storage === "disk" ? server.config.blobs.dir : "";
		expect(readdirSync(root).every((name) => /^[A-Za-z0-9_-]+$/.test(name))).toBe(true);
	});

	test("bytes that don't hash to the path are 400 HASH_MISMATCH", async () => {
		const shot = photo("mismatch");
		const other = photo("other");
		expect(await refusal(await put(server, ana.token, other.sha, shot.bytes))).toMatchObject({
			status: 400,
			code: "HASH_MISMATCH",
		});
		expect(await rowOf(server, ana.user.id, other.sha)).toBeNull();
	});

	test("anything but JPEG or WebP is 415, whatever its Content-Type says", async () => {
		const html = encoder.encode("<html><script>alert(1)</script></html>");
		const riffWav = encoder.encode("RIFF$\u0000\u0000\u0000WAVEfmt data");
		for (const bytes of [png("png"), html, riffWav, new Uint8Array(0)]) {
			const response = await put(server, ana.token, shaOf(bytes), bytes, {
				"Content-Type": "image/jpeg",
			});
			expect(await refusal(response)).toMatchObject({ status: 415, code: "UNSUPPORTED_TYPE" });
		}
	});

	test("an identical upload is idempotent: 200, one row, last_seen_at moves", async () => {
		const clock = { t: Date.now() };
		const timed = await createTestServer({ deps: { now: () => clock.t } });
		const user = await signUp(timed.app, "Ida");
		const shot = photo("idempotent");
		expect((await upload(timed, user.token, shot)).created).toBe(true);
		const first = await rowOf(timed, user.user.id, shot.sha);
		expect(first).toMatchObject({ createdAt: clock.t, lastSeenAt: clock.t });

		clock.t += 3 * DAY;
		const again = await put(timed, user.token, shot.sha, shot.bytes);
		expect(again.status).toBe(200);
		expect(((await again.json()) as BlobUpload).created).toBe(false);
		expect(await rows(timed, user.user.id)).toHaveLength(1);
		expect(await rowOf(timed, user.user.id, shot.sha)).toMatchObject({
			createdAt: first?.createdAt,
			lastSeenAt: clock.t,
		});
	});

	test("a re-upload rewrites an object the storage lost", async () => {
		const shot = photo("self-heal");
		await upload(server, ana.token, shot);
		await server.server.services.storage?.delete(ana.user.id, shot.sha);
		expect((await put(server, ana.token, shot.sha, shot.bytes)).status).toBe(200);
		expect(await server.server.services.storage?.get(ana.user.id, shot.sha)).toEqual(shot.bytes);
	});

	test("120 uploads a minute per user, then 429 with Retry-After", async () => {
		const busy = await createTestServer();
		const user = await signUp(busy.app, "Bia");
		const other = await signUp(busy.app, "Cid");
		const shot = photo("rate");
		// Malformed calls count too: the limit runs before the hash is checked.
		for (let i = 0; i < BLOB_PUT_LIMIT.max; i++) {
			expect((await put(busy, user.token, "x", shot.bytes)).status).toBe(400);
		}
		const limited = await put(busy, user.token, shot.sha, shot.bytes);
		expect(limited.status).toBe(429);
		expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
		expect(((await limited.json()) as { code: string }).code).toBe("RATE_LIMITED");
		// Per user.
		expect((await put(busy, other.token, shot.sha, shot.bytes)).status).toBe(201);
	});
});

describe("upload size (BLOB_MAX_FILE_BYTES)", () => {
	test("413 TOO_LARGE past the limit, by Content-Length or by streamed bytes", async () => {
		const server = await createTestServer({ env: { BLOB_MAX_FILE_BYTES: "4096" } });
		const user = await signUp(server.app, "Max");
		const exact = jpeg("exact", 4096);
		expect((await put(server, user.token, shaOf(exact), exact)).status).toBe(201);

		const over = jpeg("over", 4097);
		expect(await refusal(await put(server, user.token, shaOf(over), over))).toMatchObject({
			status: 413,
			code: "TOO_LARGE",
		});

		// No Content-Length (chunked): the limiter counts the bytes as they come.
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(over.subarray(0, 2048));
				controller.enqueue(over.subarray(2048));
				controller.close();
			},
		});
		const chunked = await server.app.request(`${BASE_URL}/blobs/${shaOf(over)}`, {
			method: "PUT",
			headers: bearer(user.token),
			body: stream,
			duplex: "half",
		} as RequestInit);
		expect(chunked.status).toBe(413);
		expect(await rows(server, user.user.id)).toHaveLength(1);
		const meta = await trpcData<ServerInfo>(await server.app.request(`${BASE_URL}/trpc/meta`));
		expect(meta.features.blobs).toEqual({ maxFileBytes: 4096, mimes: [...ATTACHMENT_MIMES] });
	});

	test("the default and maximum is 2 MiB", async () => {
		const server = await createTestServer();
		const user = await signUp(server.app, "Mia");
		const full = jpeg("full", 2 * 1024 * 1024);
		expect((await put(server, user.token, shaOf(full), full)).status).toBe(201);
		const over = jpeg("over", 2 * 1024 * 1024 + 1);
		expect((await refusal(await put(server, user.token, shaOf(over), over))).code).toBe(
			"TOO_LARGE",
		);
	});
});

describe("plan quota (limits.blobBytes)", () => {
	test("413 QUOTA_EXCEEDED once full; stored photos stay downloadable and re-uploadable", async () => {
		const base = await createTestServer();
		const plans = structuredClone(base.config.plans);
		const a = photo("quota-a");
		const b = photo("quota-b");
		plans.limits.pro.blobBytes = a.bytes.length + b.bytes.length; // billing off: everyone is pro
		const server = await createTestServer({ config: { plans } });
		const user = await signUp(server.app, "Quinn");
		const other = await signUp(server.app, "Rui");
		await upload(server, user.token, a);
		await upload(server, user.token, b);

		const c = photo("quota-c");
		expect(await refusal(await put(server, user.token, c.sha, c.bytes))).toMatchObject({
			status: 413,
			code: "QUOTA_EXCEEDED",
		});
		expect(await rowOf(server, user.user.id, c.sha)).toBeNull();
		expect(await server.server.services.storage?.exists(user.user.id, c.sha)).toBe(false);

		// Existing photos: idempotent re-upload and download still work.
		expect((await put(server, user.token, a.sha, a.bytes)).status).toBe(200);
		expect((await get(server, user.token, b.sha)).status).toBe(200);
		// Quotas are per user.
		expect((await put(server, other.token, c.sha, c.bytes)).status).toBe(201);

		const account = await trpcData<AccountInfo>(
			await server.app.request(`${BASE_URL}/trpc/account.get`, { headers: bearer(user.token) }),
		);
		expect(account.usage).toMatchObject({
			blobBytes: a.bytes.length + b.bytes.length,
			blobCount: 2,
		});
		expect(account.entitlements.limits.blobBytes).toBe(a.bytes.length + b.bytes.length);
	});

	test("a plan with no photo storage refuses every new photo", async () => {
		const base = await createTestServer();
		const plans = structuredClone(base.config.plans);
		plans.limits.pro.blobBytes = 0;
		const server = await createTestServer({ config: { plans } });
		const user = await signUp(server.app, "Zoe");
		const shot = photo("zero");
		expect((await refusal(await put(server, user.token, shot.sha, shot.bytes))).code).toBe(
			"QUOTA_EXCEEDED",
		);
	});
});

describe("GET /blobs/:sha256", () => {
	let server: TestServer;
	let ana: TestUser;
	let bob: TestUser;
	const shot = photo("get-jpeg");

	beforeAll(async () => {
		server = await createTestServer();
		ana = await signUp(server.app, "Ana");
		bob = await signUp(server.app, "Bob");
		await upload(server, ana.token, shot);
	});

	test("serves the owner's bytes, immutable, never sniffable or scriptable", async () => {
		const response = await get(server, ana.token, shot.sha);
		expect(response.status).toBe(200);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(shot.bytes);
		const headers: Record<string, string> = {};
		response.headers.forEach((value, name) => {
			headers[name] = value;
		});
		expect(headers).toMatchObject({
			"content-type": "image/jpeg",
			"content-length": String(shot.bytes.length),
			"cache-control": "private, max-age=31536000, immutable",
			etag: `"${shot.sha}"`,
			"x-content-type-options": "nosniff",
			"content-security-policy": "default-src 'none'",
			vary: "Authorization",
		});
	});

	test("If-None-Match answers 304 to the owner only", async () => {
		const etag = `"${shot.sha}"`;
		const cached = await get(server, ana.token, shot.sha, { "If-None-Match": etag });
		expect(cached.status).toBe(304);
		expect(await cached.text()).toBe("");
		expect((await get(server, bob.token, shot.sha, { "If-None-Match": etag })).status).toBe(404);
	});

	test("another user's blob is 404, exactly like one that doesn't exist", async () => {
		const theirs = await get(server, bob.token, shot.sha);
		const nobody = await get(server, bob.token, photo("never").sha);
		expect(await refusal(theirs)).toEqual(await refusal(nobody));
		expect(theirs.status).toBe(404);
		expect(theirs.headers.get("cache-control")).toBe("no-store");
		// Even with the same bytes: Bob's own copy is his, stored apart.
		await upload(server, bob.token, shot);
		expect((await get(server, bob.token, shot.sha)).status).toBe(200);
		expect(await rows(server, bob.user.id)).toHaveLength(1);
		await server.server.services.storage?.delete(bob.user.id, shot.sha);
		expect((await get(server, ana.token, shot.sha)).status).toBe(200);
	});

	test("401 without a session, 400 for a malformed hash", async () => {
		expect((await get(server, null, shot.sha)).status).toBe(401);
		expect((await refusal(await get(server, ana.token, "abc"))).code).toBe("INVALID_HASH");
	});

	test("a row whose object is gone: 404, the row is dropped, and the photo can come back", async () => {
		const lost = photo("lost");
		await upload(server, ana.token, lost);
		// Storage restored from an older copy, a purge that failed midway…
		await server.server.services.storage?.delete(ana.user.id, lost.sha);
		const missingNow = async () =>
			(await trpcData<{ missing: string[] }>(await missing(server, ana.token, [lost.sha]))).missing;
		expect(await missingNow()).toEqual([]); // the row still vouches for it
		expect((await get(server, ana.token, lost.sha)).status).toBe(404);
		// The row is gone with its object, so the device that holds the photo is
		// told to upload it again (its daily revalidation asks `blobs.missing`).
		expect(await rowOf(server, ana.user.id, lost.sha)).toBeNull();
		expect(await missingNow()).toEqual([lost.sha]);
		expect((await put(server, ana.token, lost.sha, lost.bytes)).status).toBe(201);
		expect((await get(server, ana.token, lost.sha)).status).toBe(200);
		const line = server.logs.map((l) => l.line).find((l) => l.includes("object-missing"));
		expect(line).toBeDefined();
		expect(line).not.toContain(lost.sha);
		expect(line).not.toContain(ana.user.id);
	});
});

describe("blobs.missing", () => {
	test("the hashes the user has no blob for, in order, without repeats", async () => {
		const server = await createTestServer();
		const ana = await signUp(server.app, "Ana");
		const bob = await signUp(server.app, "Bob");
		const [a, b, c] = [photo("m-a"), photo("m-b"), photo("m-c")];
		await upload(server, ana.token, a);
		await upload(server, bob.token, b);

		const answer = blobsMissingSchema.parse(
			await trpcData(await missing(server, ana.token, [c.sha, a.sha, b.sha, c.sha])),
		);
		// Bob's blob is not Ana's.
		expect(answer.missing).toEqual([c.sha, b.sha]);
		expect(
			(await trpcData<{ missing: string[] }>(await missing(server, ana.token, []))).missing,
		).toEqual([]);
	});

	test("batches of up to 500 hashes; anything else is 400", async () => {
		const server = await createTestServer();
		const user = await signUp(server.app, "Bat");
		const known = photo("batch-known");
		await upload(server, user.token, known);
		const hashes = Array.from({ length: BLOBS_MISSING_MAX - 1 }, (_, i) => shaOf(jpeg(`n${i}`)));
		const full = await trpcData<{ missing: string[] }>(
			await missing(server, user.token, [...hashes.slice(0, 250), known.sha, ...hashes.slice(250)]),
		);
		expect(full.missing).toEqual(hashes);
		expect((await missing(server, user.token, [...hashes, known.sha, "f".repeat(64)])).status).toBe(
			400,
		);
		expect((await missing(server, user.token, ["F".repeat(64)])).status).toBe(400);
		expect((await missing(server, user.token, "nope")).status).toBe(400);
		expect((await missing(server, null, [known.sha])).status).toBe(401);
	});

	test("a full Pro account revalidates in one go: 300 calls a minute per user, then 429", async () => {
		const server = await createTestServer();
		const user = await signUp(server.app, "Rex");
		const other = await signUp(server.app, "Ria");
		// 5 GiB of ~325 KB photo + thumbnail pairs, 500 hashes per call: 66 calls,
		// more than a limit of 60 would ever let one pass finish.
		const pairs = server.config.plans.limits.pro.blobBytes / (325 * 1024);
		const calls = Math.ceil((pairs * 2) / BLOBS_MISSING_MAX);
		expect(calls).toBeGreaterThan(60);
		expect(calls).toBeLessThanOrEqual(BLOBS_MISSING_LIMIT.max);
		const hashes = [photo("rate").sha];
		for (let call = 1; call <= BLOBS_MISSING_LIMIT.max; call++) {
			const response = await missing(server, user.token, hashes);
			if (response.status !== 200) throw new Error(`call ${call}: ${response.status}`);
		}
		const refused = await missing(server, user.token, hashes);
		expect(refused.status).toBe(429);
		expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
		// Malformed calls count too (checked before the input is parsed).
		expect((await missing(server, user.token, "nope")).status).toBe(429);
		expect((await missing(server, other.token, hashes)).status).toBe(200);
	});
});

describe("photo backup off (BLOB_STORAGE=off)", () => {
	test("routes answer 501, meta says null, and the rest of the server works", async () => {
		const server = await createTestServer({ env: { BLOB_STORAGE: "off" } });
		const user = await signUp(server.app, "Off");
		const shot = photo("off");
		expect(await refusal(await put(server, user.token, shot.sha, shot.bytes))).toMatchObject({
			status: 501,
			code: "BLOBS_DISABLED",
		});
		expect((await get(server, user.token, shot.sha)).status).toBe(501);
		const listed = await missing(server, user.token, [shot.sha]);
		expect(listed.status).toBe(501);
		expect(((await listed.json()) as { error: { data: { code: string } } }).error.data.code).toBe(
			"NOT_IMPLEMENTED",
		);
		const meta = await trpcData<ServerInfo>(await server.app.request(`${BASE_URL}/trpc/meta`));
		expect(meta.features.blobs).toBeNull();
		expect(server.server.services.blobs).toBeNull();
		expect(
			(
				await pushOk(server.app, user.token, [
					photoEntry("e1", Date.now() - 1000, [{ hash: shot.sha, thumb: shot.sha }]),
				])
			).accepted,
		).toBe(1);
		expect((await server.server.maintenance.runOnce()).blobs).toBeNull();
	});
});

describe("garbage collection (D23: 30-day tombstones, 7-day grace)", () => {
	test("keeps referenced and recent blobs; removes the rest, rows and objects", async () => {
		const clock = { t: Date.now() };
		const server = await createTestServer({ deps: { now: () => clock.t } });
		const user = await signUp(server.app, "Gus");
		const bystander = await signUp(server.app, "Ivy");
		const T0 = clock.t;
		const names = [
			"live",
			"liveThumb",
			"recent",
			"recentThumb",
			"old",
			"oldThumb",
			"loose",
			"refreshed",
			"gallery",
		] as const;
		const p = Object.fromEntries(names.map((name) => [name, photo(`gc-${name}`)])) as Record<
			(typeof names)[number],
			ReturnType<typeof photo>
		>;
		for (const item of Object.values(p)) await upload(server, user.token, item);
		// Bystander has the same "loose" photo and references it: that never protects Gus's copy.
		await upload(server, bystander.token, p.loose);
		await pushOk(server.app, bystander.token, [
			photoEntry("b1", T0 - 1000, [{ hash: p.loose.sha, thumb: p.loose.sha }]),
		]);

		await pushOk(server.app, user.token, [
			photoEntry("live", T0 - 1000, [{ hash: p.live.sha, thumb: p.liveThumb.sha }]),
			// Deleted 2 days before T0: 10 days ago at the GC below (inside the 30-day window).
			photoEntry("recent", T0 - 3 * DAY, [{ hash: p.recent.sha, thumb: p.recentThumb.sha }], {
				deletedAt: T0 - 2 * DAY,
			}),
			// Deleted 32 days before T0: 40 days ago at the GC below.
			photoEntry("old", T0 - 33 * DAY, [{ hash: p.old.sha, thumb: p.oldThumb.sha }], {
				deletedAt: T0 - 32 * DAY,
			}),
			// A field this server doesn't know (a newer client): still a reference.
			photoEntry("future", T0 - 1000, [], { extra: { gallery: [{ src: p.gallery.sha }] } }),
		]);

		// Day 6: "refreshed" is uploaded again; "late" is new and unreferenced.
		clock.t = T0 + 6 * DAY;
		expect((await put(server, user.token, p.refreshed.sha, p.refreshed.bytes)).status).toBe(200);
		const late = photo("gc-late");
		await upload(server, user.token, late);

		// Day 8.
		clock.t = T0 + 8 * DAY;
		const blobs = server.server.services.blobs as BlobService;
		const result = await blobs.gc(user.user.id);
		const gone = [p.old, p.oldThumb, p.loose];
		expect(result).toEqual({
			deleted: 3,
			bytes: gone.reduce((sum, item) => sum + item.bytes.length, 0),
			failed: 0,
		});
		const left = (await rows(server, user.user.id)).map((r) => r.sha256).sort();
		const kept = [p.live, p.liveThumb, p.recent, p.recentThumb, p.refreshed, p.gallery, late];
		expect(left).toEqual(kept.map((item) => item.sha).sort());
		const storage = server.server.services.storage as BlobStorage;
		for (const item of gone) expect(await storage.exists(user.user.id, item.sha)).toBe(false);
		for (const item of kept) expect(await storage.exists(user.user.id, item.sha)).toBe(true);
		// The bystander keeps everything.
		expect(await rowOf(server, bystander.user.id, p.loose.sha)).not.toBeNull();
		expect(await storage.exists(bystander.user.id, p.loose.sha)).toBe(true);
		// Nothing gone from the client's point of view stays listed as present.
		const listed = await trpcData<{ missing: string[] }>(
			await missing(
				server,
				user.token,
				gone.map((item) => item.sha),
			),
		);
		expect(listed.missing).toEqual(gone.map((item) => item.sha));

		// Day 14: 8 days since "refreshed" and "late" were last seen.
		clock.t = T0 + 14 * DAY;
		expect((await blobs.gc(user.user.id)).deleted).toBe(2);
		expect((await rows(server, user.user.id)).map((r) => r.sha256).sort()).toEqual(
			[p.live, p.liveThumb, p.recent, p.recentThumb, p.gallery].map((item) => item.sha).sort(),
		);

		// The logs never name a hash or a user.
		const logs = JSON.stringify(server.logs);
		for (const item of [...Object.values(p), late]) expect(logs).not.toContain(item.sha);
		expect(logs).not.toContain(user.user.id);
	});

	test("gcDue visits each user with old blobs at most once a day; maintenance runs it", async () => {
		const clock = { t: Date.now() };
		const server = await createTestServer({ deps: { now: () => clock.t } });
		const [ann, ben, cal] = [
			await signUp(server.app, "Ann"),
			await signUp(server.app, "Ben"),
			await signUp(server.app, "Cal"),
		];
		const annLoose = photo("due-ann");
		const annKept = photo("due-ann-kept");
		const benLoose = photo("due-ben");
		await upload(server, ann.token, annLoose);
		await upload(server, ann.token, annKept);
		await upload(server, ben.token, benLoose);
		await pushOk(server.app, ann.token, [
			photoEntry("kept", clock.t - 1000, [{ hash: annKept.sha, thumb: annKept.sha }]),
		]);
		clock.t += BLOB_GC_GRACE_MS + 1000;
		await upload(server, cal.token, photo("due-cal")); // recent: Cal isn't due yet

		const blobs = server.server.services.blobs as BlobService;
		expect(await blobs.gcDue()).toEqual({
			users: 2,
			deleted: 2,
			bytes: annLoose.bytes.length + benLoose.bytes.length,
			failed: 0,
			errors: 0,
		});
		// Ann still has an old (referenced) blob, but she was visited less than a day ago.
		clock.t += DAY - 2000;
		expect(await blobs.gcDue()).toMatchObject({ users: 0, deleted: 0 });
		// A week later Ann is due again (her photo is still referenced), and so is Cal.
		clock.t += BLOB_GC_GRACE_MS;
		const report = await server.server.maintenance.runOnce();
		expect(report.blobs).toMatchObject({ users: 2, deleted: 1, errors: 0 });
		expect(await rowOf(server, ann.user.id, annKept.sha)).not.toBeNull();
		expect(await rows(server, cal.user.id)).toEqual([]);
		const line = server.logs.map((l) => l.line).find((l) => l.includes("op=gc"));
		expect(line).toContain("users=2 deleted=2");
		expect(line).not.toContain(ann.user.id);
	});

	test("references are kept generously: refs, any SHA-shaped string, unparseable text", () => {
		const sha = (c: string) => c.repeat(64);
		const refs = new Set<string>();
		collectReferences(
			JSON.stringify({
				data: {
					photos: [{ hash: sha("a"), thumb: sha("b"), mime: "image/jpeg", w: 1, h: 1, bytes: 1 }],
					cover: { hash: sha("c"), thumb: sha("d") }, // not a valid ref: kept anyway
					nested: [[{ deep: sha("e") }]],
					text: `not ${sha("f")} a ref`, // inside prose: not a reference
					upper: sha("A"),
				},
			}),
			refs,
		);
		expect([...refs].sort()).toEqual([sha("a"), sha("b"), sha("c"), sha("d"), sha("e")]);
		const raw = new Set<string>();
		collectReferences(`{"broken": "${sha("9")}"`, raw);
		expect([...raw]).toEqual([sha("9")]);
	});
});

describe("GC ordering and the per-user lock", () => {
	let server: TestServer;
	let user: TestUser;
	let other: TestUser;
	const clock = { t: Date.now() };

	beforeAll(async () => {
		server = await createTestServer({ deps: { now: () => clock.t } });
		user = await signUp(server.app, "Lou");
		other = await signUp(server.app, "Max");
	});

	/** A service on the server's database whose storage reports what happens. */
	function instrumented(hooks: Partial<BlobStorage> = {}) {
		const disk = createDiskStorage(join(scratchDir(), "blobs"));
		const storage: BlobStorage = { ...disk, ...hooks };
		const service = createBlobService({
			db: server.db,
			storage,
			entitlements: server.server.services.entitlements,
			log: server.server.services.log,
			now: () => clock.t,
			maxFileBytes: server.config.blobMaxFileBytes,
		});
		return { service, disk };
	}

	test("rows are deleted before their objects; a failed object delete only orphans it", async () => {
		const seen: { sha: string; rowsLeft: number }[] = [];
		const failing = photo("ord-fail");
		const { service, disk } = instrumented({
			async delete(userId, sha) {
				seen.push({ sha, rowsLeft: (await rowOf(server, userId, sha)) ? 1 : 0 });
				if (sha === failing.sha) throw new Error("disk on fire");
				return disk.delete(userId, sha);
			},
		});
		const items = [photo("ord-1"), photo("ord-2"), failing];
		for (const item of items) {
			expect(await service.put(user.user.id, item.sha, item.bytes)).toMatchObject({ ok: true });
		}
		clock.t += BLOB_GC_GRACE_MS + 1;
		const result = await service.gc(user.user.id);
		expect(result).toMatchObject({ deleted: 3, failed: 1 });
		expect(seen.map((s) => s.sha).sort()).toEqual(items.map((i) => i.sha).sort());
		expect(seen.every((s) => s.rowsLeft === 0)).toBe(true);
		expect(await rows(server, user.user.id)).toHaveLength(0);
		expect(await disk.exists(user.user.id, failing.sha)).toBe(true); // orphan, not a broken row
		const warn = server.logs.map((l) => l.line).find((l) => l.includes("outcome=orphaned"));
		expect(warn).toContain("count=1");
		expect(warn).not.toContain("disk on fire");
	});

	test("an upload waits for the user's GC, so the photo it re-uploads survives", async () => {
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const events: string[] = [];
		const victim = photo("lock-victim");
		const { service, disk } = instrumented({
			async delete(userId, sha) {
				events.push("gc:object-delete");
				await gate;
				return disk.delete(userId, sha);
			},
		});
		await service.put(user.user.id, victim.sha, victim.bytes);
		clock.t += BLOB_GC_GRACE_MS + 1;

		const gcRun = service.gc(user.user.id).then((r) => {
			events.push("gc:done");
			return r;
		});
		while (!events.includes("gc:object-delete")) await Bun.sleep(1);
		// The row is already gone; without the lock this upload would recreate it
		// and then lose its object to the GC still running.
		const putRun = service.put(user.user.id, victim.sha, victim.bytes).then((r) => {
			events.push("put:done");
			return r;
		});
		// Another user is never blocked by this one.
		const elsewhere = photo("lock-elsewhere");
		expect(await service.put(other.user.id, elsewhere.sha, elsewhere.bytes)).toMatchObject({
			ok: true,
			created: true,
		});
		await Bun.sleep(20);
		expect(events).toEqual(["gc:object-delete"]);

		release();
		await Promise.all([gcRun, putRun]);
		expect(events).toEqual(["gc:object-delete", "gc:done", "put:done"]);
		expect(await putRun).toMatchObject({ ok: true, created: true });
		expect(await rowOf(server, user.user.id, victim.sha)).not.toBeNull();
		expect(await disk.exists(user.user.id, victim.sha)).toBe(true);
	});

	test("the purge waits for an upload in flight and refuses uploads afterwards", async () => {
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const events: string[] = [];
		const shot = photo("purge-race");
		const { service, disk } = instrumented({
			async put(userId, sha, bytes) {
				events.push("put:object");
				await gate;
				return disk.put(userId, sha, bytes);
			},
			async deleteUser(userId) {
				events.push("purge:objects");
				return disk.deleteUser(userId);
			},
		});
		const putRun = service.put(other.user.id, shot.sha, shot.bytes);
		while (!events.includes("put:object")) await Bun.sleep(1);
		const purgeRun = service.purgeUser(other.user.id);
		await Bun.sleep(20);
		expect(events).toEqual(["put:object"]);
		release();
		await Promise.all([putRun, purgeRun]);
		expect(events).toEqual(["put:object", "purge:objects"]);
		expect(await disk.exists(other.user.id, shot.sha)).toBe(false);

		const late = photo("purge-late");
		expect(await service.put(other.user.id, late.sha, late.bytes)).toMatchObject({
			ok: false,
			code: "ACCOUNT_CLOSED",
		});
		expect(await disk.exists(other.user.id, late.sha)).toBe(false);
		expect(await rows(server, other.user.id)).toEqual([]);
	});

	test("the purge drops rows only once every object is gone", async () => {
		const doomed = await signUp(server.app, "Pia");
		let broken = true;
		const { service, disk } = instrumented({
			async deleteUser(userId) {
				if (broken) throw new Error("bucket on fire");
				return disk.deleteUser(userId);
			},
		});
		const shot = photo("purge-order");
		await service.put(doomed.user.id, shot.sha, shot.bytes);
		// Storage failed: nothing changed, uploads reopen, a retry finishes the job.
		await expect(service.purgeUser(doomed.user.id)).rejects.toThrow();
		expect(await rows(server, doomed.user.id)).toHaveLength(1);
		const after = photo("purge-reopened");
		expect(await service.put(doomed.user.id, after.sha, after.bytes)).toMatchObject({ ok: true });
		broken = false;
		await service.purgeUser(doomed.user.id);
		expect(await disk.exists(doomed.user.id, shot.sha)).toBe(false);
		// Should the account's deletion fail after this step, no row vouches for
		// a deleted photo: devices are told to upload them again.
		expect(await rows(server, doomed.user.id)).toEqual([]);
		expect(await service.missing(doomed.user.id, [shot.sha, after.sha])).toEqual([
			shot.sha,
			after.sha,
		]);
	});

	test("a download finding no object serves the copy an upload is rewriting, and keeps the row", async () => {
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const events: string[] = [];
		let holdWrites = false;
		const { service, disk } = instrumented({
			async put(userId, sha, bytes) {
				if (holdWrites) {
					events.push("put:object");
					await gate;
				}
				return disk.put(userId, sha, bytes);
			},
		});
		const shot = photo("repair-race");
		await service.put(user.user.id, shot.sha, shot.bytes);
		await disk.delete(user.user.id, shot.sha); // lost
		holdWrites = true;
		// The re-upload (under the lock) is about to write the object again…
		const putRun = service.put(user.user.id, shot.sha, shot.bytes);
		while (!events.includes("put:object")) await Bun.sleep(1);
		// …while a download finds it missing and queues for the lock to repair.
		const getRun = service.get(user.user.id, shot.sha);
		await Bun.sleep(20);
		release();
		expect(await putRun).toMatchObject({ ok: true, created: false });
		expect(await getRun).toEqual({ bytes: shot.bytes, mime: "image/jpeg" });
		expect(await rowOf(server, user.user.id, shot.sha)).not.toBeNull();
		expect(await service.missing(user.user.id, [shot.sha])).toEqual([]);
	});

	test("the service checks size, type and hash itself too", async () => {
		const { service } = instrumented();
		const big = jpeg("big", server.config.blobMaxFileBytes + 1);
		expect(await service.put(user.user.id, shaOf(big), big)).toMatchObject({
			ok: false,
			status: 413,
			code: "TOO_LARGE",
		});
		expect(await service.put(user.user.id, "../x", jpeg("x"))).toMatchObject({
			code: "INVALID_HASH",
		});
		expect(sniffImage(jpeg("j"))).toBe("image/jpeg");
		expect(sniffImage(webp("w"))).toBe("image/webp");
		expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
		expect(sniffImage(encoder.encode("RIFF\u0000\u0000\u0000\u0000WEBPJUNK"))).toBeNull();
	});
});

describe("account deletion purges photos (rows and objects)", () => {
	test("delete-user removes every object and row; other users keep theirs", async () => {
		const server = await createTestServer();
		const doomed = await signUp(server.app, "Dee");
		const keeper = await signUp(server.app, "Kai");
		const shot = photo("purge-http");
		await upload(server, doomed.token, shot);
		await upload(server, keeper.token, shot);
		const response = await postJson(
			server.app,
			"/api/auth/delete-user",
			{ password: doomed.password },
			bearer(doomed.token),
		);
		expect(response.status).toBe(200);
		expect(await rows(server, doomed.user.id)).toEqual([]);
		const dir = server.config.blobs?.storage === "disk" ? server.config.blobs.dir : "";
		expect(existsSync(join(dir, doomed.user.id))).toBe(false);
		expect((await get(server, keeper.token, shot.sha)).status).toBe(200);
		expect((await put(server, doomed.token, shot.sha, shot.bytes)).status).toBe(401);
	});
});

describe("S3 storage (Bun.S3Client against a local fake)", () => {
	let s3: FakeS3;

	beforeAll(() => {
		s3 = startFakeS3();
	});
	afterAll(() => s3.stop());

	const storageFor = (fake: FakeS3) =>
		createS3Storage({
			storage: "s3",
			endpoint: fake.endpoint,
			bucket: fake.bucket,
			accessKeyId: "test-access-key",
			secretAccessKey: "test-secret-key",
			region: "auto",
		});

	test("keys u/<userId>/<sha>, signed requests, null for a missing object", async () => {
		const storage = storageFor(s3);
		const shot = photo("s3-unit");
		await storage.put("user1", shot.sha, shot.bytes, "image/jpeg");
		expect(s3.objects.get(`u/user1/${shot.sha}`)).toMatchObject({ type: "image/jpeg" });
		expect(await storage.get("user1", shot.sha)).toEqual(shot.bytes);
		expect(await storage.exists("user1", shot.sha)).toBe(true);
		expect(await storage.get("user2", shot.sha)).toBeNull();
		expect(await storage.exists("user2", shot.sha)).toBe(false);
		await storage.delete("user1", shot.sha);
		await storage.delete("user1", shot.sha); // idempotent
		expect(await storage.get("user1", shot.sha)).toBeNull();
		expect(s3.requests.every((r) => r.signed)).toBe(true);
		// Paths are built only from validated parts.
		await expect(storage.put("../evil", shot.sha, shot.bytes)).rejects.toThrow("bad user id");
		await expect(storage.get("user1", "../../etc/passwd")).rejects.toThrow("bad sha256");
	});

	test("deleteUser pages through the user's prefix only", async () => {
		const storage = storageFor(s3);
		s3.pageSize = 2;
		const mine = Array.from({ length: 5 }, (_, i) => photo(`s3-mine-${i}`));
		const theirs = photo("s3-theirs");
		for (const item of mine) await storage.put("purge-me", item.sha, item.bytes);
		await storage.put("purge-me-not", theirs.sha, theirs.bytes);
		await storage.deleteUser("purge-me");
		s3.pageSize = 1000;
		expect([...s3.objects.keys()].filter((k) => k.startsWith("u/purge-me/"))).toEqual([]);
		expect(s3.objects.has(`u/purge-me-not/${theirs.sha}`)).toBe(true);
		const listings = s3.requests.filter((r) => r.search.includes("list-type=2"));
		expect(listings.length).toBeGreaterThan(1);
		expect(listings.every((r) => r.search.includes("prefix=u%2Fpurge-me%2F"))).toBe(true);
	});

	test("deleteUser deletes in parallel, a bounded number at a time", async () => {
		const fake = startFakeS3("atomic-parallel");
		try {
			const storage = storageFor(fake);
			const items = Array.from({ length: 20 }, (_, i) => photo(`s3-many-${i}`));
			for (const item of items) await storage.put("many", item.sha, item.bytes);
			fake.deleteDelayMs = 25;
			await storage.deleteUser("many");
			expect([...fake.objects.keys()].filter((k) => k.startsWith("u/many/"))).toEqual([]);
			expect(fake.maxConcurrentDeletes).toBeGreaterThan(1);
			expect(fake.maxConcurrentDeletes).toBeLessThanOrEqual(S3_DELETE_CONCURRENCY);
		} finally {
			fake.stop();
		}
	});

	test("a silent endpoint: every request gives up at its deadline, and no lock stays held", async () => {
		const fake = startFakeS3("atomic-silent");
		try {
			const timeoutMs = 150;
			const storage = createS3Storage(
				{
					storage: "s3",
					endpoint: fake.endpoint,
					bucket: fake.bucket,
					accessKeyId: "test-access-key",
					secretAccessKey: "test-secret-key",
					region: "auto",
				},
				{ timeoutMs },
			);
			const kept = photo("s3-silent-kept");
			await storage.put("quiet", kept.sha, kept.bytes);
			fake.hang = true;
			const started = performance.now();
			const outcomes = await Promise.allSettled([
				storage.put("quiet", photo("s3-silent-new").sha, kept.bytes),
				storage.get("quiet", kept.sha),
				storage.exists("quiet", kept.sha),
				storage.delete("quiet", kept.sha),
				storage.deleteUser("quiet"),
			]);
			expect(performance.now() - started).toBeLessThan(timeoutMs * 10);
			for (const outcome of outcomes) {
				expect(outcome.status).toBe("rejected");
				expect((outcome as PromiseRejectedResult).reason).toBeInstanceOf(StorageTimeoutError);
			}

			// The service: a 503-class failure, then the user's next call runs.
			const clock = { t: Date.now() };
			const server = await createTestServer({ deps: { now: () => clock.t } });
			const user = await signUp(server.app, "Quinn");
			const service = createBlobService({
				db: server.db,
				storage,
				entitlements: server.server.services.entitlements,
				log: server.server.services.log,
				now: () => clock.t,
				maxFileBytes: server.config.blobMaxFileBytes,
			});
			const shot = photo("s3-silent-service");
			await expect(service.put(user.user.id, shot.sha, shot.bytes)).rejects.toBeInstanceOf(
				BlobStorageError,
			);
			expect(await rowOf(server, user.user.id, shot.sha)).toBeNull();
			await expect(service.purgeUser(user.user.id)).rejects.toBeInstanceOf(StorageTimeoutError);
			fake.hang = false;
			expect(await service.put(user.user.id, shot.sha, shot.bytes)).toMatchObject({
				ok: true,
				created: true,
			});
			// GC finishes too: rows go, the silent deletes only leave orphans.
			clock.t += BLOB_GC_GRACE_MS + 1;
			fake.hang = true;
			expect(await service.gc(user.user.id)).toMatchObject({ deleted: 1, failed: 1 });
			expect(await rows(server, user.user.id)).toEqual([]);
			const text = JSON.stringify(server.logs);
			expect(text).toContain("StorageTimeoutError");
			expect(text).not.toContain(shot.sha);
			expect(text).not.toContain(user.user.id);
		} finally {
			fake.stop();
		}
	});

	test("the app on S3: upload, download, missing, GC and account deletion", async () => {
		const fake = startFakeS3("atomic-app");
		try {
			const clock = { t: Date.now() };
			const server = await createTestServer({ env: s3Env(fake), deps: { now: () => clock.t } });
			const user = await signUp(server.app, "Sam");
			const kept = photo("s3-app-kept", "webp");
			const loose = photo("s3-app-loose");
			await upload(server, user.token, kept);
			await upload(server, user.token, loose);
			expect(fake.objects.has(`u/${user.user.id}/${kept.sha}`)).toBe(true);
			const response = await get(server, user.token, kept.sha);
			expect(response.headers.get("content-type")).toBe("image/webp");
			expect(new Uint8Array(await response.arrayBuffer())).toEqual(kept.bytes);

			await pushOk(server.app, user.token, [
				photoEntry("s3e", clock.t - 1000, [{ hash: kept.sha, thumb: kept.sha }]),
			]);
			clock.t += BLOB_GC_GRACE_MS + 1;
			expect((await server.server.maintenance.runOnce()).blobs).toMatchObject({ deleted: 1 });
			expect(fake.objects.has(`u/${user.user.id}/${loose.sha}`)).toBe(false);
			expect(fake.objects.has(`u/${user.user.id}/${kept.sha}`)).toBe(true);

			const deleted = await postJson(
				server.app,
				"/api/auth/delete-user",
				{ password: user.password },
				bearer(user.token),
			);
			expect(deleted.status).toBe(200);
			expect([...fake.objects.keys()].some((k) => k.includes(user.user.id))).toBe(false);
		} finally {
			fake.stop();
		}
	});

	test("an S3 outage is 503 STORAGE_UNAVAILABLE, writes no row and logs no content", async () => {
		const fake = startFakeS3("atomic-down");
		try {
			const server = await createTestServer({ env: s3Env(fake) });
			const user = await signUp(server.app, "Una");
			const stored = photo("s3-down-stored");
			await upload(server, user.token, stored);
			fake.down = true;
			const shot = photo("s3-down");
			expect(await refusal(await put(server, user.token, shot.sha, shot.bytes))).toMatchObject({
				status: 503,
				code: "STORAGE_UNAVAILABLE",
			});
			expect(await rowOf(server, user.user.id, shot.sha)).toBeNull();
			expect((await get(server, user.token, stored.sha)).status).toBe(503);
			// Deleting the account can't remove the photos: nothing is deleted, retry later.
			const deleted = await postJson(
				server.app,
				"/api/auth/delete-user",
				{ password: user.password },
				bearer(user.token),
			);
			expect(deleted.status).toBe(503);
			expect(((await deleted.json()) as { code: string }).code).toBe("PURGE_BLOBS_FAILED");
			fake.down = false;
			expect((await put(server, user.token, shot.sha, shot.bytes)).status).toBe(201);
			const logs = JSON.stringify(server.logs);
			expect(logs).toContain("storage-failed");
			expect(logs).not.toContain(shot.sha);
			expect(logs).not.toContain(user.user.id);
			expect(logs).not.toContain(fake.endpoint);
		} finally {
			fake.stop();
		}
	});
});

describe("disk storage", () => {
	test("<dir>/<userId>/<sha[0:2]>/<sha>, atomic writes, validated parts", async () => {
		const dir = join(scratchDir(), "disk");
		const storage = createDiskStorage(dir);
		const shot = photo("disk");
		await storage.put("u_1", shot.sha, shot.bytes);
		expect(readdirSync(join(dir, "u_1", shot.sha.slice(0, 2)))).toEqual([shot.sha]);
		expect(await storage.get("u_1", shot.sha)).toEqual(shot.bytes);
		expect(await storage.get("u_1", photo("none").sha)).toBeNull();
		await storage.deleteUser("u_1");
		expect(existsSync(join(dir, "u_1"))).toBe(false);
		await expect(storage.put("a/b", shot.sha, shot.bytes)).rejects.toThrow("bad user id");
		await expect(storage.exists("u_1", "..")).rejects.toThrow("bad sha256");
	});
});

describe("logs (spec §4.2)", () => {
	test("request lines carry the route template, never a hash, token or user", async () => {
		const server = await createTestServer({ env: { LOG_FORMAT: "json" } });
		const user = await signUp(server.app, "Leo");
		const shot = photo("log-route");
		await upload(server, user.token, shot);
		await get(server, user.token, shot.sha);
		await missing(server, user.token, [shot.sha]);
		await put(server, user.token, shot.sha, png("x"));
		const lines = server.logs.map((l) => JSON.parse(l.line) as Record<string, unknown>);
		const routes = lines.filter((l) => l.msg === "req").map((l) => `${l.method} ${l.route}`);
		expect(routes).toContain("PUT /blobs/:sha256");
		expect(routes).toContain("GET /blobs/:sha256");
		expect(routes).toContain("POST /trpc/blobs.missing");
		const text = JSON.stringify(server.logs);
		expect(text).not.toContain(shot.sha);
		expect(text).not.toContain(user.token);
		expect(text).not.toContain(user.user.id);
		expect(text).not.toContain(user.email);
	});
});
