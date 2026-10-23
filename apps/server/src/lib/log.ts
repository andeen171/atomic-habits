import type { LogFormat } from "../config";

/**
 * Content-free structured logging (spec §4.2, Annex C §1.10).
 *
 * A log line is a flat record of primitives: no objects, so an error, a
 * request body or a header bag can't be passed in by accident. Callers log
 * tags, codes, route templates and counts; never user text, emails, tokens,
 * query strings, IPs or bodies.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogValue = string | number | boolean | null | undefined;

export interface LogFields {
	/** What happened: "req", "trpc", "error", "config", "auth"… */
	msg: string;
	[field: string]: LogValue;
}

export type LogSink = (level: LogLevel, line: string) => void;

export interface Logger {
	debug(fields: LogFields): void;
	info(fields: LogFields): void;
	warn(fields: LogFields): void;
	error(fields: LogFields): void;
}

const consoleSink: LogSink = (level, line) => {
	if (level === "error" || level === "warn") console.error(line);
	else console.log(line);
};

function pretty(level: LogLevel, at: Date, fields: LogFields): string {
	const { msg, ...rest } = fields;
	const time = at.toISOString().slice(11, 23);
	const extra = Object.entries(rest)
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => `${key}=${value}`)
		.join(" ");
	return `${time} ${level.toUpperCase().padEnd(5)} ${msg}${extra ? ` ${extra}` : ""}`;
}

export function createLogger(
	options: { format?: LogFormat; sink?: LogSink; now?: () => number } = {},
): Logger {
	const format = options.format ?? "json";
	const sink = options.sink ?? consoleSink;
	const now = options.now ?? Date.now;
	const write = (level: LogLevel, fields: LogFields) => {
		const at = new Date(now());
		const line =
			format === "json"
				? JSON.stringify({ t: at.toISOString(), lvl: level, ...fields })
				: pretty(level, at, fields);
		sink(level, line);
	};
	return {
		debug: (fields) => write("debug", fields),
		info: (fields) => write("info", fields),
		warn: (fields) => write("warn", fields),
		error: (fields) => write("error", fields),
	};
}

/** A short machine identifier (an error name, a cause): letters, digits, `_.:-`, ≤ 60 chars. */
export function safeTag(value: unknown): string | undefined {
	if (typeof value !== "string" || !value) return undefined;
	return /^[\w.:-]{1,60}$/.test(value) ? value : "other";
}
