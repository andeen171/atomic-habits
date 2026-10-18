import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { publicProcedure, router } from "../src/trpc/init";

const testRouter = router({
	boom: publicProcedure.query(() => {
		throw new Error("SQLITE_ERROR: no such table: secret_table");
	}),
	denied: publicProcedure.query(() => {
		throw new TRPCError({ code: "FORBIDDEN", message: "Nope" });
	}),
});

async function call(path: string) {
	const response = await fetchRequestHandler({
		endpoint: "/trpc",
		req: new Request(`http://localhost/trpc/${path}`),
		router: testRouter,
		createContext: () => ({ session: null }) as never,
	});
	return { status: response.status, text: await response.text() };
}

describe("error formatting", () => {
	test("internal errors expose neither the message nor a stack", async () => {
		const { status, text } = await call("boom");
		expect(status).toBe(500);
		expect(text).toContain("Internal server error");
		expect(text).not.toContain("secret_table");
		expect(JSON.parse(text).error.data.stack).toBeUndefined();
	});

	test("expected errors keep their message but no stack", async () => {
		const { status, text } = await call("denied");
		expect(status).toBe(403);
		expect(JSON.parse(text).error.message).toBe("Nope");
		expect(JSON.parse(text).error.data.stack).toBeUndefined();
	});
});
