/**
 * Turns the single-file build (dist-artifact/index.html) into the page body
 * the claude.ai Artifact host expects: it wraps the file in its own
 * <!doctype>/<html>/<head>/<body> skeleton, so we ship <title>, styles and
 * scripts followed by the app root — no document wrapper of our own.
 *
 * Usage: bun scripts/artifact-page.ts  →  dist-artifact/atomic.html
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const TITLE = "Atomic Habit Tracker";
const dir = path.resolve(import.meta.dir, "../dist-artifact");
const html = readFileSync(path.join(dir, "index.html"), "utf8");

const section = (tag: "head" | "body") => {
	const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*)</${tag}>`, "i").exec(html);
	if (!match?.[1]) throw new Error(`No <${tag}> in the artifact build`);
	return match[1];
};

const blocks = (source: string, tag: "style" | "script") =>
	source.match(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi")) ?? [];

const head = section("head");
const body = section("body");
const styles = blocks(head, "style");
const headScripts = blocks(head, "script");
const classic = headScripts.filter((s) => !/type=["']?module/i.test(s));
const modules = headScripts.filter((s) => /type=["']?module/i.test(s));

const page = [
	`<title>${TITLE}</title>`,
	...styles,
	...classic,
	body.trim(),
	// Module scripts are deferred: they run after the app root exists.
	...modules,
].join("\n");

if (!page.includes('id="app"')) throw new Error("App root missing from the artifact page");
writeFileSync(path.join(dir, "atomic.html"), page);
console.log(
	`atomic.html: ${(page.length / 1024).toFixed(0)} KiB, ${styles.length} style, ${classic.length + modules.length} script blocks`,
);
