import { z } from "zod";
import type { AiJsonMode } from "../config";

/**
 * The model adapter (spec §4.5, Annex C §6.6): one OpenAI-compatible
 * `POST {AI_BASE_URL}/chat/completions`, which llama.cpp's server, Ollama
 * and hosted providers all speak.
 *
 * Every failure becomes a content-free `AiError`: a kind, the HTTP status
 * the API answers with and, for upstream failures, the upstream status.
 * Neither the prompt nor the reply ever reaches an error, a log or a cache.
 */

export type AiErrorKind =
	/** The user's daily quota is used up (429). */
	| "quota"
	/** The model is saturated, or the server's daily cap is reached (503). */
	| "busy"
	/** The end-to-end deadline passed (504). */
	| "timeout"
	/** The model failed or gave an unusable answer (502). */
	| "failed"
	/** The client went away (499); nobody reads the answer. */
	| "aborted"
	/** An answer that isn't the expected JSON (retried once, then `failed`). */
	| "invalid";

const STATUS: Record<AiErrorKind, number> = {
	quota: 429,
	busy: 503,
	timeout: 504,
	failed: 502,
	aborted: 499,
	invalid: 502,
};

export class AiError extends Error {
	override readonly name = "AiError";
	/** The HTTP status the API answers with. */
	readonly status: number;

	constructor(
		readonly kind: AiErrorKind,
		readonly detail: {
			/** The model server's HTTP status (a number, never its body). */
			upstreamStatus?: number;
			/** When to try again (quota: the next 00:00 UTC). */
			retryAt?: number;
		} = {},
	) {
		// Content-free by construction: the message is the kind, nothing else.
		super(`ai_${kind}`);
		this.status = STATUS[kind];
	}
}

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface CompletionRequest {
	/** System prompt first, then few-shot turns, then the user's data. */
	messages: ChatMessage[];
	/** The answer's JSON schema (sent in `json_schema` mode). */
	schema: Record<string, unknown>;
	/** `[a-z_]` name of the schema (`response_format.json_schema.name`). */
	schemaName: string;
	maxTokens: number;
	temperature: number;
	/** Aborts the call (deadline or client gone). */
	signal: AbortSignal;
}

export interface CompletionResult {
	/** The parsed JSON answer, not validated yet. */
	value: unknown;
	/** `usage.completion_tokens` when the server reports it. */
	tokensOut: number;
}

export interface AiProvider {
	complete(request: CompletionRequest): Promise<CompletionResult>;
}

export interface ProviderOptions {
	/** `AI_BASE_URL`, e.g. `http://llm:8080/v1` (no trailing slash). */
	baseUrl: string;
	apiKey: string | null;
	model: string;
	jsonMode: AiJsonMode;
	fetch: typeof fetch;
}

/**
 * Bigger replies are refused (max_tokens keeps honest ones far below); the
 * body is read with this cap, so a broken upstream can't fill the memory.
 */
export const MAX_REPLY_BYTES = 256 * 1024;

/** The body as UTF-8 text, or null as soon as it passes `max` bytes (then cancelled). */
async function readCapped(response: Response, max: number): Promise<string | null> {
	const reader = response.body?.getReader();
	if (!reader) return "";
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			await reader.cancel().catch(() => {});
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

const replySchema = z.looseObject({
	choices: z
		.array(
			z.looseObject({
				message: z.looseObject({ content: z.string().nullable().optional() }),
			}),
		)
		.min(1),
	usage: z.looseObject({ completion_tokens: z.number().int().min(0) }).nullish(),
});

/** The `response_format` of a request, by `AI_JSON_MODE`. */
export function responseFormat(
	jsonMode: AiJsonMode,
	name: string,
	schema: Record<string, unknown>,
): Record<string, unknown> | undefined {
	if (jsonMode === "json_schema") {
		return { type: "json_schema", json_schema: { name, strict: true, schema } };
	}
	if (jsonMode === "json_object") return { type: "json_object" };
	return undefined; // prompt mode: the system prompt carries the schema
}

/**
 * The JSON object in a model's text: as is, inside a Markdown fence, or
 * between the first `{` and the last `}` (prompt mode chatter).
 */
export function parseModelJson(content: string): unknown {
	const text = content.trim();
	const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)?.[1] ?? text;
	try {
		return JSON.parse(fenced);
	} catch {
		const start = fenced.indexOf("{");
		const end = fenced.lastIndexOf("}");
		if (start >= 0 && end > start) {
			try {
				return JSON.parse(fenced.slice(start, end + 1));
			} catch {
				// Below.
			}
		}
		throw new AiError("invalid");
	}
}

export function createOpenAICompatibleProvider(options: ProviderOptions): AiProvider {
	const url = `${options.baseUrl}/chat/completions`;
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;

	return {
		async complete(request) {
			const { signal } = request;
			const format = responseFormat(options.jsonMode, request.schemaName, request.schema);
			const body = JSON.stringify({
				model: options.model,
				messages: request.messages,
				temperature: request.temperature,
				max_tokens: request.maxTokens,
				n: 1,
				stream: false,
				...(format ? { response_format: format } : {}),
			});
			let response: Response;
			try {
				response = await options.fetch(url, { method: "POST", headers, body, signal });
			} catch {
				// The cause (a network error or the abort) is never kept: it may echo the URL.
				throw new AiError(signal.aborted ? "timeout" : "failed");
			}
			if (!response.ok) {
				// Never read: an upstream error page can echo the prompt.
				await response.body?.cancel().catch(() => {});
				const upstreamStatus = response.status;
				// Overloaded upstreams (llama.cpp with every slot busy, hosted rate limits).
				const kind = upstreamStatus === 429 || upstreamStatus === 503 ? "busy" : "failed";
				throw new AiError(kind, { upstreamStatus });
			}
			// An oversized reply is an upstream fault, not a model slip: no retry.
			const declared = Number(response.headers.get("content-length") ?? 0);
			if (declared > MAX_REPLY_BYTES) {
				await response.body?.cancel().catch(() => {});
				throw new AiError("failed");
			}
			let text: string | null;
			try {
				text = await readCapped(response, MAX_REPLY_BYTES);
			} catch {
				throw new AiError(signal.aborted ? "timeout" : "failed");
			}
			if (text === null) throw new AiError("failed");
			let reply: z.infer<typeof replySchema>;
			try {
				reply = replySchema.parse(JSON.parse(text));
			} catch {
				throw new AiError("invalid");
			}
			const content = reply.choices[0]?.message.content;
			if (typeof content !== "string" || !content.trim()) throw new AiError("invalid");
			return {
				value: parseModelJson(content),
				tokensOut: reply.usage?.completion_tokens ?? 0,
			};
		},
	};
}
