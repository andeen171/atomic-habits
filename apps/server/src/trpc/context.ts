import { auth } from "../lib/auth";
import { bearerOnlyHeaders } from "../lib/request";

/** Resolves the caller from `Authorization: Bearer <token>` (cookies are ignored). */
export async function createContext({ headers }: { headers: Headers }) {
	const session = await auth.api.getSession({ headers: bearerOnlyHeaders(headers) });
	return { session };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
