import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { user } from "../src/db/schema";
import { BASE_URL, createTestServer } from "./helpers";

async function signUp(app: any, name: string) {
	const email = `${name.toLowerCase()}-${crypto.randomUUID()}@example.com`;
	const password = "correct horse battery";
	const res = await app.request(`${BASE_URL}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password, name }),
	});
	const body = (await res.json()) as any;
	return { token: body.token as string, id: body.user.id as string, password };
}

describe("probe", () => {
	test("delete-user path variants", async () => {
		const server = await createTestServer();
		for (const path of ["/api/auth/delete-user/", "/api/auth//delete-user", "/api/auth/Delete-User", "/api/auth/delete-user?x=1", "/api/auth/./delete-user", "/api/auth/delete-user%2F"]) {
			const { token, id } = await signUp(server.app, "Probe");
			const res = await server.app.request(`${BASE_URL}${path}`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
				body: JSON.stringify({}),
			});
			const exists = (await server.db.select({ id: user.id }).from(user).where(eq(user.id, id))).length === 1;
			console.log("PROBE", path, res.status, (await res.text()).slice(0, 120), "exists=", exists);
		}
	});
});
