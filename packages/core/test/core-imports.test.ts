import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SRC, runtimeClosure, sourceFiles, srcPath, srcRelative } from "./support/import-graph";

/**
 * The React boundary (spec §3, D52). The server image installs `@atomic/core`
 * with `--omit peer`, so nothing reachable from `src/index.ts` may load
 * react. Hooks live in `react.ts` and the `react-*.ts` / `trackers/react.ts`
 * modules it re-exports (`@atomic/core/react`).
 */

/** Packages that are (or pull in) React. `zustand`'s root entry imports react; `zustand/vanilla` doesn't. */
const REACT_RE =
	/^(react|react-dom|react-native|use-sync-external-store|zustand|zustand\/react|zustand\/traditional)(\/.*)?$/;
const isReactPackage = (specifier: string) =>
	REACT_RE.test(specifier) && !/^zustand\/(vanilla|middleware|shallow)$/.test(specifier);
const isHookModule = (file: string) => /(^|\/)react(-[a-z-]+)?\.ts$/.test(srcRelative(file));

/** Node built-ins have no place in src: it runs on Hermes and in browsers too. */
const NODE_RE =
	/^(node:|fs$|path$|os$|crypto$|stream$|buffer$|util$|child_process$|url$|http$|https$|zlib$)/;

describe("core imports", () => {
	test("nothing reachable from src/index.ts imports react", () => {
		const closure = runtimeClosure(srcPath("index.ts"));
		const offenders: string[] = [];
		for (const [file, imports] of closure) {
			if (isHookModule(file)) offenders.push(`${srcRelative(file)} (hook module)`);
			for (const specifier of imports.bare) {
				if (isReactPackage(specifier)) offenders.push(`${srcRelative(file)} → ${specifier}`);
			}
		}
		expect(offenders).toEqual([]);
		// The walk really covers the package (guards against a broken scanner).
		expect(closure.size).toBeGreaterThan(30);
		expect([...closure.keys()].map(srcRelative)).toContain("trackers/schema.ts");
	});

	test("hook modules are exported from react.ts", () => {
		const reactExports = runtimeClosure(srcPath("react.ts"));
		for (const file of sourceFiles()) {
			if (isHookModule(file) && !file.endsWith(`${join("src", "react.ts")}`)) {
				expect({ file: srcRelative(file), reachable: reactExports.has(file) }).toEqual({
					file: srcRelative(file),
					reachable: true,
				});
			}
		}
	});

	test("src never imports Node built-ins", () => {
		const offenders: string[] = [];
		for (const file of sourceFiles()) {
			for (const specifier of runtimeClosure(file).get(file)?.bare ?? []) {
				if (NODE_RE.test(specifier)) offenders.push(`${srcRelative(file)} → ${specifier}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	test("src avoids APIs that Hermes lacks (String.normalize, \\p{…} escapes)", () => {
		const offenders: string[] = [];
		for (const file of sourceFiles()) {
			const code = readFileSync(file, "utf8")
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/(^|[^:])\/\/.*$/gm, "$1");
			if (/\.normalize\(/.test(code)) offenders.push(`${srcRelative(file)}: normalize()`);
			if (/\\[pP]\{/.test(code)) offenders.push(`${srcRelative(file)}: \\p{…}`);
		}
		expect(offenders).toEqual([]);
	});

	test("loading the root entry never loads react at runtime", () => {
		const preload = join(import.meta.dir, "support", "no-react-preload.ts");
		const load = (entry: string) =>
			Bun.spawnSync({
				cmd: [
					process.execPath,
					"--preload",
					preload,
					"-e",
					`await import(${JSON.stringify(srcPath(entry))})`,
				],
				cwd: SRC,
				stderr: "pipe",
				stdout: "pipe",
			});
		const root = load("index.ts");
		if (root.exitCode !== 0) throw new Error(root.stderr.toString());
		// Control: the guard does catch react (react.ts imports it).
		const hooks = load("react.ts");
		expect(hooks.exitCode).not.toBe(0);
		expect(hooks.stderr.toString()).toContain("react loaded");
	});
});
