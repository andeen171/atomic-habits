import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * A small static import scanner for `packages/core/src`, used by
 * `core-imports.test.ts` (no react reachable from the root entry) and
 * `schema-v2.test.ts` (no runtime import cycles, so no TDZ errors).
 *
 * Type-only imports (`import type …`, `export type …`, or braces whose every
 * specifier is `type X`) are erased at runtime and are not runtime edges.
 */

export const SRC = resolve(import.meta.dir, "../../src");

export interface ModuleImports {
	/** Relative imports kept at runtime, resolved to absolute file paths. */
	runtime: string[];
	/** Package specifiers kept at runtime ("zod", "zustand/vanilla", "react"…). */
	bare: string[];
	/** Relative or package specifiers imported for types only. */
	typeOnly: string[];
}

const FROM_RE = /^\s*(import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']/gm;
const SIDE_EFFECT_RE = /^\s*import\s+["']([^"']+)["']/gm;
const DYNAMIC_RE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

function isTypeOnly(clause: string): boolean {
	const c = clause.trim();
	if (c.startsWith("type ")) return true;
	const braces = /^\{([\s\S]*)\}$/.exec(c);
	if (!braces) return false;
	const specifiers = (braces[1] ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	return specifiers.length > 0 && specifiers.every((s) => s.startsWith("type "));
}

function resolveRelative(from: string, specifier: string): string {
	const base = resolve(dirname(from), specifier);
	for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	throw new Error(`Cannot resolve ${specifier} from ${relative(SRC, from)}`);
}

const cache = new Map<string, ModuleImports>();

export function moduleImports(file: string): ModuleImports {
	const cached = cache.get(file);
	if (cached) return cached;
	const source = readFileSync(file, "utf8");
	const out: ModuleImports = { runtime: [], bare: [], typeOnly: [] };
	const add = (specifier: string, typeOnly: boolean) => {
		if (typeOnly) {
			out.typeOnly.push(specifier);
			return;
		}
		if (specifier.startsWith(".")) out.runtime.push(resolveRelative(file, specifier));
		else out.bare.push(specifier);
	};
	for (const m of source.matchAll(FROM_RE)) add(m[3] ?? "", isTypeOnly(m[2] ?? ""));
	for (const m of source.matchAll(SIDE_EFFECT_RE)) add(m[1] ?? "", false);
	for (const m of source.matchAll(DYNAMIC_RE)) add(m[1] ?? "", false);
	cache.set(file, out);
	return out;
}

/** Every module reachable from `entry` through runtime imports. */
export function runtimeClosure(entry: string): Map<string, ModuleImports> {
	const seen = new Map<string, ModuleImports>();
	const queue = [entry];
	while (queue.length) {
		const file = queue.pop() as string;
		if (seen.has(file)) continue;
		const imports = moduleImports(file);
		seen.set(file, imports);
		queue.push(...imports.runtime);
	}
	return seen;
}

/** Every `.ts` file under `src`. */
export function sourceFiles(dir = SRC): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
		else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(path);
	}
	return out.sort();
}

/** Runtime import cycles among `files`, each as a list of src-relative paths. */
export function runtimeCycles(files: readonly string[]): string[][] {
	const cycles: string[][] = [];
	const state = new Map<string, "visiting" | "done">();
	const stack: string[] = [];
	const visit = (file: string) => {
		state.set(file, "visiting");
		stack.push(file);
		for (const next of moduleImports(file).runtime) {
			const s = state.get(next);
			if (s === "visiting") {
				cycles.push([...stack.slice(stack.indexOf(next)), next].map((f) => relative(SRC, f)));
			} else if (!s) {
				visit(next);
			}
		}
		stack.pop();
		state.set(file, "done");
	};
	for (const file of files) if (!state.has(file)) visit(file);
	return cycles;
}

export const srcPath = (path: string) => join(SRC, path);
export const srcRelative = (file: string) => relative(SRC, file);
