import { type Config, ConfigError, loadConfig } from "../src/config";
import { type Database, createDb } from "../src/db";

/**
 * Shared start-up for the operator scripts: the server's own configuration
 * (`loadConfig(process.env)`, so a script sees exactly what the server sees,
 * `.env` included) and a database connection. Scripts never migrate: the
 * server does that when it starts.
 */

export interface ScriptContext {
	config: Config;
	db: Database;
	close(): void;
}

export function openScript(): ScriptContext {
	let config: Config;
	try {
		config = loadConfig(process.env);
	} catch (error) {
		if (error instanceof ConfigError) fail(error.message, 2);
		throw error;
	}
	const db = createDb(config);
	return { config, db, close: () => db.$client.close() };
}

export function fail(message: string, code = 1): never {
	console.error(message);
	process.exit(code);
}

/** `--flag value` or `--flag=value` from `args`; removes them. */
export function takeOption(args: string[], name: string): string | undefined {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] as string;
		if (arg === name) {
			const value = args[i + 1];
			args.splice(i, 2);
			return value;
		}
		if (arg.startsWith(`${name}=`)) {
			args.splice(i, 1);
			return arg.slice(name.length + 1);
		}
	}
	return undefined;
}

/** Whether `--flag` is present in `args`; removes it. */
export function takeFlag(args: string[], name: string): boolean {
	const at = args.indexOf(name);
	if (at === -1) return false;
	args.splice(at, 1);
	return true;
}
