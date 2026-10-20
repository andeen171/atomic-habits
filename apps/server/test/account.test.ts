import { beforeAll, describe, expect, test } from "bun:test";
import {
	type AccountInfo,
	EXPORT_FORMAT,
	EXPORT_LINK_TTL_MS,
	type ExportLink,
	type SessionInfo,
	accountInfoSchema,
	exportFileSchema,
	sessionInfoSchema,
	sha256Hex,
} from "@atomic/core";
import type { WireSyncRecord } from "@atomic/core/sync";
import { and, eq } from "drizzle-orm";
import {
	account,
	aiUsage,
	blob,
	exportToken,
	planGrant,
	session,
	subscription,
	syncCursor,
	syncRecord,
	user,
} from "../src/db/schema";
import { zip64 } from "../src/lib/zip";
import { BILLING_ENV, type FakeStripe, createFakeStripe } from "./fakes";
import {
	type AuthBody,
	BASE_URL,
	type TestServer,
	type TestUser,
	bearer,
	createTestServer,
	postJson,
	pushOk,
	signUp,
	task,
	trpcData,
	uniqueEmail,
} from "./helpers";
import { readZip } from "./zip-reader";

/**
 * `account.*`, password change, deletion with full erasure, and the
 * single-use export link (spec §4.3, §4.5, §4.6; D55, D69).
 */

async function get<T>(server: TestServer, path: string, token: string): Promise<T> {
	return trpcData<T>(
		await server.app.request(`${BASE_URL}/trpc/${path}`, { headers: bearer(token) }),
	);
}

function mutate(server: TestServer, path: string, token: string, input?: unknown) {
	return postJson(server.app, `/trpc/${path}`, input ?? {}, bearer(token));
}

async function status(server: TestServer, token: string): Promise<number> {
	return (await server.app.request(`${BASE_URL}/trpc/me`, { headers: bearer(token) })).status;
}

async function signIn(
	server: TestServer,
	who: Pick<TestUser, "email" | "password">,
	headers: Record<string, string> = {},
): Promise<string> {
	const response = await postJson(
		server.app,
		"/api/auth/sign-in/email",
		{ email: who.email, password: who.password },
		headers,
	);
	expect(response.status).toBe(200);
	return ((await response.json()) as AuthBody).token ?? "";
}

/** Fake photo bytes (storage never sniffs; the blob routes do). */
function photoBytes(seed: string): Uint8Array {
	return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(seed)]);
}

async function storePhoto(server: TestServer, userId: string, seed: string) {
	const bytes = photoBytes(seed);
	const sha = await sha256Hex(bytes);
	await server.server.services.storage?.put(userId, sha, bytes);
	await server.db
		.insert(blob)
		.values({ userId, sha256: sha, size: bytes.length, mime: "image/jpeg" });
	return { sha, bytes };
}

function photoEntry(
	id: string,
	refs: { hash: string; thumb: string },
	deletedAt: number | null = null,
): WireSyncRecord {
	const at = Date.now() - 1000;
	return {
		collection: "trackerEntries",
		id,
		updatedAt: deletedAt ?? at,
		deletedAt,
		data: {
			id,
			createdAt: at,
			updatedAt: deletedAt ?? at,
			deletedAt,
			habitId: "h1",
			date: "2026-10-20",
			type: "x-photo-test",
			at: null,
			data: {
				photos: [{ ...refs, mime: "image/jpeg", w: 10, h: 10, bytes: 100, alt: null }],
			},
		},
	};
}

describe("sessions (ids, times and device labels only)", () => {
	let server: TestServer;

	beforeAll(async () => {
		server = await createTestServer({ env: { CLIENT_IP_HEADER: "x-forwarded-for" } });
	});

	test("lists every device, the current one first, with no token or IP", async () => {
		const ip = "203.0.113.9";
		const email = uniqueEmail("sam");
		const password = "correct horse battery";
		const up = await postJson(
			server.app,
			"/api/auth/sign-up/email",
			{ name: "Sam", email, password },
			{ "X-Atomic-Device": "Atomic Android · Pixel 8", "X-Forwarded-For": ip },
		);
		const phone = ((await up.json()) as AuthBody).token ?? "";
		const laptop = await signIn(
			server,
			{ email, password },
			{ "X-Atomic-Device": "Atomic Web · Firefox\u0007", "X-Forwarded-For": ip },
		);
		const bare = await signIn(server, { email, password }, { "User-Agent": "" });

		const response = await server.app.request(`${BASE_URL}/trpc/account.sessions`, {
			headers: bearer(laptop),
		});
		const text = await response.clone().text();
		for (const secret of [phone, laptop, bare, ip]) expect(text).not.toContain(secret);
		const list = await trpcData<SessionInfo[]>(response);
		expect(list).toHaveLength(3);
		for (const item of list) {
			expect(Object.keys(item).sort()).toEqual([
				"createdAt",
				"current",
				"device",
				"id",
				"lastActiveAt",
			]);
			expect(sessionInfoSchema.safeParse(item).success).toBe(true);
		}
		expect(list[0]).toMatchObject({ current: true, device: "Atomic Web · Firefox" });
		expect(list.filter((s) => s.current)).toHaveLength(1);
		expect(list.map((s) => s.device)).toContain("Atomic Android · Pixel 8");
	});

	test("revoking one device signs it out; another user's id revokes nothing", async () => {
		const owner = await signUp(server.app, "Ola");
		const other = await signIn(server, owner);
		const stranger = await signUp(server.app, "Ted");
		const list = await get<SessionInfo[]>(server, "account.sessions", owner.token);
		const target = list.find((s) => !s.current);
		expect(target).toBeDefined();

		const foreign = await mutate(server, "account.revokeSession", stranger.token, {
			id: target?.id,
		});
		expect(await trpcData(foreign)).toEqual({ revoked: 0 });
		expect(await status(server, other)).toBe(200);

		const revoke = await mutate(server, "account.revokeSession", owner.token, { id: target?.id });
		expect(await trpcData(revoke)).toEqual({ revoked: 1 });
		expect(await status(server, other)).toBe(401);
		expect(await status(server, owner.token)).toBe(200);
	});

	test("sign out of all other devices keeps this one", async () => {
		const owner = await signUp(server.app, "Ivo");
		const second = await signIn(server, owner);
		const third = await signIn(server, owner);
		const revoke = await mutate(server, "account.revokeOtherSessions", third);
		expect(await trpcData(revoke)).toEqual({ revoked: 2 });
		expect(await status(server, owner.token)).toBe(401);
		expect(await status(server, second)).toBe(401);
		expect(await status(server, third)).toBe(200);
		expect(await get<SessionInfo[]>(server, "account.sessions", third)).toHaveLength(1);
	});

	test("every account procedure needs a session", async () => {
		for (const path of ["account.get", "account.sessions"]) {
			expect((await server.app.request(`${BASE_URL}/trpc/${path}`)).status).toBe(401);
		}
		for (const path of [
			"account.revokeSession",
			"account.revokeOtherSessions",
			"account.exportLink",
		]) {
			expect((await postJson(server.app, `/trpc/${path}`, { id: "x" })).status).toBe(401);
		}
	});
});

describe("password change", () => {
	let server: TestServer;

	beforeAll(async () => {
		server = await createTestServer();
	});

	test("with 'sign out of other devices' the token is swapped and every old one ends", async () => {
		const owner = await signUp(server.app, "Noa");
		const other = await signIn(server, owner);
		const response = await postJson(
			server.app,
			"/api/auth/change-password",
			{
				currentPassword: owner.password,
				newPassword: "a whole new password",
				revokeOtherSessions: true,
			},
			bearer(owner.token),
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as AuthBody;
		expect(body.token).toBeTruthy();
		expect(body.token).not.toBe(owner.token);
		expect(response.headers.get("set-auth-token")).toBeTruthy();
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(await status(server, body.token ?? "")).toBe(200);
		expect(await status(server, owner.token)).toBe(401);
		expect(await status(server, other)).toBe(401);
		await signIn(server, { email: owner.email, password: "a whole new password" });
	});

	test("without it, every device stays signed in", async () => {
		const owner = await signUp(server.app, "Ugo");
		const other = await signIn(server, owner);
		const response = await postJson(
			server.app,
			"/api/auth/change-password",
			{ currentPassword: owner.password, newPassword: "a whole new password" },
			bearer(owner.token),
		);
		expect(response.status).toBe(200);
		expect(((await response.json()) as AuthBody).token).toBeNull();
		expect(await status(server, owner.token)).toBe(200);
		expect(await status(server, other)).toBe(200);
	});

	test("a wrong current password changes nothing", async () => {
		const owner = await signUp(server.app, "Eli");
		const response = await postJson(
			server.app,
			"/api/auth/change-password",
			{ currentPassword: "not the password", newPassword: "a whole new password" },
			bearer(owner.token),
		);
		expect(response.status).toBe(400);
		await signIn(server, owner);
	});
});

describe("account.get", () => {
	test("profile, sign-in methods, AI consent, plan and usage", async () => {
		const server = await createTestServer();
		const owner = await signUp(server.app, "Ana");
		await pushOk(server.app, owner.token, [task("t1", Date.now() - 1000)]);
		const info = await get<AccountInfo>(server, "account.get", owner.token);
		expect(accountInfoSchema.parse(info)).toEqual(info);
		expect(info).toMatchObject({
			id: owner.user.id,
			email: owner.email,
			name: "Ana",
			emailVerified: false,
			providers: ["credential"],
			hasPassword: true,
			ai: { consentAt: null, translate: false },
			entitlements: { plan: "pro", source: "billing-disabled", status: "active" },
		});
		expect(info.usage).toMatchObject({
			aiRequestsToday: 0,
			aiTranslateCharsToday: 0,
			blobBytes: 0,
			blobCount: 0,
		});
		expect(info.usage.syncBytes).toBeGreaterThan(0);
		expect(info.usage.aiResetsAt % 86_400_000).toBe(0);
	});

	test("clients can rename themselves but never set the AI consent fields", async () => {
		const server = await createTestServer();
		const owner = await signUp(server.app, "Ana");
		const sneaky = await postJson(
			server.app,
			"/api/auth/update-user",
			{ name: "Ana Maria", aiConsentAt: Date.now(), aiTranslate: true },
			bearer(owner.token),
		);
		expect(sneaky.status).toBe(400);
		const rename = await postJson(
			server.app,
			"/api/auth/update-user",
			{ name: "Ana Maria" },
			bearer(owner.token),
		);
		expect(rename.status).toBe(200);
		const info = await get<AccountInfo>(server, "account.get", owner.token);
		expect(info.name).toBe("Ana Maria");
		expect(info.ai).toEqual({ consentAt: null, translate: false });

		// Sign-up refuses an explicit consent time and ignores the translate flag.
		const withConsent = await postJson(server.app, "/api/auth/sign-up/email", {
			name: "Bia",
			email: uniqueEmail(),
			password: "correct horse battery",
			aiConsentAt: Date.now(),
		});
		expect(withConsent.status).toBe(400);
		const withTranslate = await postJson(server.app, "/api/auth/sign-up/email", {
			name: "Cai",
			email: uniqueEmail(),
			password: "correct horse battery",
			aiTranslate: true,
		});
		expect(withTranslate.status).toBe(200);
		const token = ((await withTranslate.json()) as AuthBody).token ?? "";
		const created = await get<AccountInfo>(server, "account.get", token);
		expect(created.ai).toEqual({ consentAt: null, translate: false });
	});
});

describe("account deletion erases everything (LGPD art. 18 VI)", () => {
	let server: TestServer;
	let stripe: FakeStripe;

	beforeAll(async () => {
		stripe = createFakeStripe();
		server = await createTestServer({ env: BILLING_ENV, deps: { stripe } });
	});

	/** A user with something in every table that hangs off `user`. */
	async function populated(name: string) {
		const owner = await signUp(server.app, name);
		const id = owner.user.id;
		const photo = await storePhoto(server, id, `${name}-photo`);
		await pushOk(server.app, owner.token, [
			task("t1", Date.now() - 1000),
			photoEntry("e1", { hash: photo.sha, thumb: photo.sha }),
		]);
		await server.db.insert(aiUsage).values({ userId: id, day: "2026-10-20", requests: 3 });
		await server.db
			.insert(planGrant)
			.values({ id: `g-${id}`, userId: id, plan: "pro", reason: "beta" });
		await server.db.insert(subscription).values({
			id: `s-${id}`,
			plan: "pro",
			referenceId: id,
			stripeCustomerId: `cus_${name}`,
			stripeSubscriptionId: `sub_${name}`,
			status: "active",
		});
		await server.db
			.update(user)
			.set({ stripeCustomerId: `cus_${name}` })
			.where(eq(user.id, id));
		await mutate(server, "account.exportLink", owner.token);
		return { owner, id, photo };
	}

	async function footprint(id: string) {
		const count = async (table: typeof syncRecord | typeof blob, column: unknown) =>
			(
				await server.db
					.select()
					.from(table as typeof syncRecord)
					.where(eq(column as typeof syncRecord.userId, id))
			).length;
		return {
			user: (await server.db.select().from(user).where(eq(user.id, id))).length,
			account: await count(account as never, account.userId),
			session: await count(session as never, session.userId),
			syncRecord: await count(syncRecord, syncRecord.userId),
			syncCursor: await count(syncCursor as never, syncCursor.userId),
			blob: await count(blob, blob.userId),
			aiUsage: await count(aiUsage as never, aiUsage.userId),
			planGrant: await count(planGrant as never, planGrant.userId),
			exportToken: await count(exportToken as never, exportToken.userId),
			subscription: (
				await server.db.select().from(subscription).where(eq(subscription.referenceId, id))
			).length,
		};
	}

	test("cancels Stripe, deletes the customer, the photos and every row", async () => {
		const bystander = await populated("Bea");
		const { owner, id, photo } = await populated("Dora");
		expect(Object.values(await footprint(id)).every((n) => n > 0)).toBe(true);

		const response = await postJson(
			server.app,
			"/api/auth/delete-user",
			{ password: owner.password },
			bearer(owner.token),
		);
		expect(response.status).toBe(200);
		expect(stripe.canceled).toContain("sub_Dora");
		expect(stripe.deletedCustomers).toContain("cus_Dora");
		expect(Object.values(await footprint(id)).every((n) => n === 0)).toBe(true);
		expect(await server.server.services.storage?.get(id, photo.sha)).toBeNull();
		expect(await status(server, owner.token)).toBe(401);

		// Nobody else is touched.
		expect(Object.values(await footprint(bystander.id)).every((n) => n > 0)).toBe(true);
		expect(await server.server.services.storage?.get(bystander.id, bystander.photo.sha)).toEqual(
			bystander.photo.bytes,
		);
		expect(stripe.canceled).not.toContain("sub_Bea");
		const logs = JSON.stringify(server.logs);
		expect(logs).not.toContain(owner.email);
		expect(logs).not.toContain("sub_Dora");
	});

	test("a Stripe failure aborts with 502 and deletes nothing; a retry completes", async () => {
		const { owner, id, photo } = await populated("Iris");
		const before = await footprint(id);
		stripe.cancelError = Object.assign(new Error("card_declined: secret detail"), {
			statusCode: 500,
		});
		const failed = await postJson(
			server.app,
			"/api/auth/delete-user",
			{ password: owner.password },
			bearer(owner.token),
		);
		expect(failed.status).toBe(502);
		expect(((await failed.json()) as { code: string }).code).toBe("BILLING_CANCEL_FAILED");
		expect(await footprint(id)).toEqual(before);
		expect(await server.server.services.storage?.get(id, photo.sha)).toEqual(photo.bytes);
		expect(await status(server, owner.token)).toBe(200);
		expect(JSON.stringify(server.logs)).not.toContain("secret detail");

		stripe.cancelError = null;
		const retried = await postJson(
			server.app,
			"/api/auth/delete-user",
			{ password: owner.password },
			bearer(owner.token),
		);
		expect(retried.status).toBe(200);
		expect(Object.values(await footprint(id)).every((n) => n === 0)).toBe(true);
	});

	test("a subscription Stripe no longer knows doesn't block deletion", async () => {
		const { owner, id } = await populated("Olga");
		stripe.cancelError = Object.assign(new Error("No such subscription"), {
			code: "resource_missing",
			statusCode: 404,
		});
		const response = await postJson(
			server.app,
			"/api/auth/delete-user",
			{ password: owner.password },
			bearer(owner.token),
		);
		stripe.cancelError = null;
		expect(response.status).toBe(200);
		expect((await footprint(id)).user).toBe(0);
	});

	test("with billing off, deletion still erases photos and rows", async () => {
		const plain = await createTestServer();
		const owner = await signUp(plain.app, "Zed");
		const bytes = photoBytes("zed");
		const sha = await sha256Hex(bytes);
		await plain.server.services.storage?.put(owner.user.id, sha, bytes);
		await plain.db
			.insert(blob)
			.values({ userId: owner.user.id, sha256: sha, size: bytes.length, mime: "image/jpeg" });
		const response = await postJson(
			plain.app,
			"/api/auth/delete-user",
			{ password: owner.password },
			bearer(owner.token),
		);
		expect(response.status).toBe(200);
		expect(await plain.server.services.storage?.get(owner.user.id, sha)).toBeNull();
		expect(await plain.db.select().from(blob).where(eq(blob.userId, owner.user.id))).toEqual([]);
	});
});

describe("account export link (D69)", () => {
	let server: TestServer;
	let now = Date.now();

	beforeAll(async () => {
		server = await createTestServer({ env: { LOG_FORMAT: "json" }, deps: { now: () => now } });
	});

	const exportLink = async (token: string) =>
		trpcData<ExportLink>(await mutate(server, "account.exportLink", token));

	test("a single-use link streams a ZIP64 archive of live data and live photos", async () => {
		const owner = await signUp(server.app, "Eva");
		const id = owner.user.id;
		const live = await storePhoto(server, id, "live");
		const thumb = await storePhoto(server, id, "thumb");
		const gone = await storePhoto(server, id, "gone");
		const loose = await storePhoto(server, id, "loose");
		const t = Date.now() - 5000;
		await pushOk(server.app, owner.token, [
			task("t1", t, { title: "Read 20 pages" }),
			task("t2", t, { deletedAt: t }),
			photoEntry("e-live", { hash: live.sha, thumb: thumb.sha }),
			photoEntry("e-gone", { hash: gone.sha, thumb: gone.sha }, t),
		]);
		// Someone else's live photo never leaks in.
		const stranger = await signUp(server.app, "Kim");
		const theirs = await storePhoto(server, stranger.user.id, "theirs");
		await pushOk(server.app, stranger.token, [
			photoEntry("e-theirs", { hash: theirs.sha, thumb: theirs.sha }),
		]);

		now = Date.now();
		const link = await exportLink(owner.token);
		expect(link.expiresAt).toBe(now + EXPORT_LINK_TTL_MS);
		const url = new URL(link.url);
		expect(`${url.origin}${url.pathname}`).toBe(`${BASE_URL}/account/export`);
		const secret = url.searchParams.get("t") ?? "";
		expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
		// Only the SHA-256 is stored.
		const rows = await server.db.select().from(exportToken).where(eq(exportToken.userId, id));
		expect(rows).toHaveLength(1);
		expect(JSON.stringify(rows)).not.toContain(secret);

		const response = await server.app.request(link.url);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/zip");
		expect(response.headers.get("content-disposition")).toMatch(
			/^attachment; filename="atomic-export-\d{4}-\d{2}-\d{2}\.zip"$/,
		);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
		const archive = readZip(new Uint8Array(await response.arrayBuffer()));
		expect(archive.zip64End).toBe(true);
		for (const entry of archive.entries) {
			expect(entry.zip64Extra).toBe(true);
			expect(entry.zip64Descriptor).toBe(true);
		}
		expect(archive.entries.map((e) => e.name).sort()).toEqual(
			["export.json", `photos/${live.sha}.jpg`, `photos/${thumb.sha}.jpg`].sort(),
		);
		expect(archive.entries.find((e) => e.name === `photos/${live.sha}.jpg`)?.data).toEqual(
			live.bytes,
		);

		const json = JSON.parse(
			new TextDecoder().decode(archive.entries.find((e) => e.name === "export.json")?.data),
		) as Record<string, unknown> & {
			account: Record<string, unknown>;
			data: Record<string, { id: string }[]>;
		};
		const file = exportFileSchema.parse(json);
		expect(file.format).toBe(EXPORT_FORMAT);
		expect(file.version).toBe(2);
		expect(json.account).toMatchObject({ email: owner.email, name: "Eva", plan: "pro" });
		expect(json.data.tasks?.map((r) => r.id)).toEqual(["t1"]);
		expect(json.data.trackerEntries?.map((r) => r.id)).toEqual(["e-live"]);
		expect(JSON.stringify(json)).toContain("Read 20 pages");
		expect(JSON.stringify(json)).not.toContain(theirs.sha);
		expect(JSON.stringify(json)).not.toContain(loose.sha);

		// Single use.
		const again = await server.app.request(link.url);
		expect(again.status).toBe(410);
		expect(again.headers.get("cache-control")).toBe("no-store");
		expect(again.headers.get("referrer-policy")).toBe("no-referrer");
		// The token never reaches a log line.
		expect(JSON.stringify(server.logs)).not.toContain(secret);
		const routes = server.logs
			.map((l) => JSON.parse(l.line) as { msg: string; route?: string })
			.filter((l) => l.msg === "req" && l.route?.startsWith("/account"));
		expect(routes.map((l) => l.route)).toContain("/account/export");
	});

	test("expires after 10 minutes", async () => {
		const owner = await signUp(server.app, "Ian");
		now = Date.now();
		const link = await exportLink(owner.token);
		now += EXPORT_LINK_TTL_MS + 1;
		expect((await server.app.request(link.url)).status).toBe(410);
		now = Date.now();
	});

	test("forged and malformed tokens are refused alike", async () => {
		for (const t of ["", "short", "A".repeat(43), `${"A".repeat(42)}=`]) {
			const response = await server.app.request(`${BASE_URL}/account/export?t=${t}`);
			expect(response.status).toBe(410);
		}
	});

	test("3 links per hour per user, then 429 with Retry-After", async () => {
		const owner = await signUp(server.app, "Leo");
		for (let i = 0; i < 3; i++) await exportLink(owner.token);
		const limited = await mutate(server, "account.exportLink", owner.token);
		expect(limited.status).toBe(429);
		expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
		const other = await signUp(server.app, "Mia");
		await exportLink(other.token);
	});

	test("HEAD never spends the token: link checkers and download probes leave it usable", async () => {
		const owner = await signUp(server.app, "Hal");
		now = Date.now();
		const link = await exportLink(owner.token);
		const head = await server.app.request(link.url, { method: "HEAD" });
		expect(head.status).toBe(405);
		expect(head.headers.get("allow")).toBe("GET");
		expect(head.headers.get("cache-control")).toBe("no-store");
		const download = await server.app.request(link.url);
		expect(download.status).toBe(200);
		expect(download.headers.get("content-type")).toBe("application/zip");
		await download.arrayBuffer();
		expect((await server.app.request(link.url)).status).toBe(410);
	});

	test("links end when devices are signed out or the password changes (D55)", async () => {
		const owner = await signUp(server.app, "Rex");
		now = Date.now();
		const linkStatus = async (url: string) =>
			(await server.app.request(url, { method: "GET" })).status;

		// "Sign out of all other devices".
		const second = await signIn(server, owner);
		let link = await exportLink(second);
		expect(
			await trpcData(await mutate(server, "account.revokeOtherSessions", owner.token)),
		).toEqual({
			revoked: 1,
		});
		expect(await linkStatus(link.url)).toBe(410);

		// One device signed out from Security.
		const third = await signIn(server, owner);
		link = await exportLink(third);
		const sessions = await get<SessionInfo[]>(server, "account.sessions", owner.token);
		const other = sessions.find((s) => !s.current)?.id ?? "";
		expect(
			await trpcData(await mutate(server, "account.revokeSession", owner.token, { id: other })),
		).toEqual({ revoked: 1 });
		expect(await linkStatus(link.url)).toBe(410);
		// Revoking nothing (another user's id) leaves links alone.
		link = await exportLink(owner.token);
		expect(
			await trpcData(await mutate(server, "account.revokeSession", owner.token, { id: "nope" })),
		).toEqual({ revoked: 0 });

		// A password change, with or without signing out the other devices.
		const changed = await postJson(
			server.app,
			"/api/auth/change-password",
			{ currentPassword: owner.password, newPassword: "a whole new password" },
			bearer(owner.token),
		);
		expect(changed.status).toBe(200);
		expect(await linkStatus(link.url)).toBe(410);
		// A failed change keeps them.
		now = Date.now() + 2 * 3_600_000; // past the 3-per-hour link limit
		const kept = await exportLink(owner.token);
		const wrong = await postJson(
			server.app,
			"/api/auth/change-password",
			{ currentPassword: "not the password", newPassword: "another new password" },
			bearer(owner.token),
		);
		expect(wrong.status).toBe(400);
		expect(await linkStatus(kept.url)).toBe(200);
		now = Date.now();
	});

	test("a link dies with its account", async () => {
		const owner = await signUp(server.app, "Ned");
		now = Date.now();
		const link = await exportLink(owner.token);
		await postJson(
			server.app,
			"/api/auth/delete-user",
			{ password: owner.password },
			bearer(owner.token),
		);
		expect((await server.app.request(link.url)).status).toBe(410);
		expect(
			await server.db
				.select()
				.from(exportToken)
				.where(and(eq(exportToken.userId, owner.user.id))),
		).toEqual([]);
	});
});

describe("zip writer", () => {
	async function collect(parts: AsyncGenerator<Uint8Array>) {
		const chunks: Uint8Array[] = [];
		for await (const chunk of parts) chunks.push(chunk);
		return new Uint8Array(Buffer.concat(chunks));
	}

	test("streams entries of every shape into an archive a strict reader accepts", async () => {
		const big = new Uint8Array(300_000).map((_, i) => (i * 31) % 251);
		async function* slow() {
			yield new TextEncoder().encode("first,");
			yield new Uint8Array(0);
			yield new TextEncoder().encode("second");
		}
		const bytes = await collect(
			zip64(
				[
					{ name: "a.txt", data: new TextEncoder().encode("hello") },
					{ name: "empty.bin", data: new Uint8Array(0) },
					{ name: "dir/ünïcode.txt", data: slow() },
					{ name: "big.bin", data: [big.subarray(0, 100_000), big.subarray(100_000)] },
				],
				{ modified: new Date(Date.UTC(2026, 9, 20, 12, 30, 10)) },
			),
		);
		const archive = readZip(bytes);
		expect(archive.zip64End).toBe(true);
		const text = (name: string) =>
			new TextDecoder().decode(archive.entries.find((e) => e.name === name)?.data);
		expect(text("a.txt")).toBe("hello");
		expect(text("dir/ünïcode.txt")).toBe("first,second");
		expect(archive.entries.find((e) => e.name === "empty.bin")?.data).toHaveLength(0);
		expect(archive.entries.find((e) => e.name === "big.bin")?.data).toEqual(big);
		for (const entry of archive.entries) expect(entry.flags & 0x0800).toBe(0x0800);
	});

	test("an empty archive is still valid", async () => {
		const archive = readZip(await collect(zip64([], { modified: new Date() })));
		expect(archive.entries).toEqual([]);
		expect(archive.zip64End).toBe(true);
	});
});

describe("export link base URL (no BETTER_AUTH_URL)", () => {
	const linkFor = async (server: TestServer, headers: Record<string, string>) => {
		const owner = await signUp(server.app, "Pat");
		const response = await server.app.request(`${BASE_URL}/trpc/account.exportLink`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...bearer(owner.token), ...headers },
			body: "{}",
		});
		return (await trpcData<ExportLink>(response)).url;
	};

	test("behind the trusted proxy, the proxy's X-Forwarded-Proto gives https", async () => {
		const server = await createTestServer({
			env: { BETTER_AUTH_URL: "", CLIENT_IP_HEADER: "x-forwarded-for" },
		});
		expect(server.config.authUrl).toBeNull();
		const url = await linkFor(server, {
			Host: "sync.example.com",
			"X-Forwarded-For": "203.0.113.9",
			"X-Forwarded-Proto": "https",
		});
		expect(url).toStartWith("https://localhost/account/export?t=");
	});

	test("without a trusted proxy, a client's X-Forwarded-Proto is ignored", async () => {
		const server = await createTestServer({ env: { BETTER_AUTH_URL: "" } });
		const url = await linkFor(server, { "X-Forwarded-Proto": "https" });
		expect(url).toStartWith("http://localhost/account/export?t=");
	});

	test("BETTER_AUTH_URL wins whatever the headers say", async () => {
		const server = await createTestServer({
			env: { BETTER_AUTH_URL: "https://sync.example.com", CLIENT_IP_HEADER: "x-forwarded-for" },
		});
		const url = await linkFor(server, { "X-Forwarded-Proto": "http" });
		expect(url).toStartWith("https://sync.example.com/account/export?t=");
	});
});
