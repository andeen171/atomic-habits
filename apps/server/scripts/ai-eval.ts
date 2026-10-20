import { type EvalCaseResult, runAiEval, summarize } from "../src/admin/ai-eval";
import { createOpenAICompatibleProvider } from "../src/ai/provider";
import { fail, openScript, takeOption } from "./_cli";

/**
 * Manual AI quality check (Annex C §6.5; never in CI). Sends fixed cases
 * per suggestion kind and language (default 30 each), plus translations
 * both ways, to AI_BASE_URL / AI_MODEL with the server's own prompts and
 * output checks, then reports JSON validity, usable answers, language match
 * and latency:
 *
 *   bun run scripts/ai-eval.ts [--count 30] [--kinds habit.name,translate] [--out report.json]
 *
 * No quota, database or user data is involved. Run it against the model
 * you are about to deploy (e.g. with the compose `ai` profile up:
 * `docker compose exec server bun run scripts/ai-eval.ts --count 5`).
 */

const args = process.argv.slice(2);
const usage = "usage: bun run scripts/ai-eval.ts [--count N] [--kinds a,b] [--out file.json]";
if (args.includes("--help") || args.includes("-h")) fail(usage, 0);
const count = Number(takeOption(args, "--count") ?? 30);
const kinds = takeOption(args, "--kinds")
	?.split(",")
	.map((k) => k.trim())
	.filter(Boolean);
const out = takeOption(args, "--out");
if (!Number.isInteger(count) || count < 1 || count > 200 || args.length) fail(usage, 2);

const { config, close } = openScript();
close();
const ai = config.ai;
if (!ai)
	fail(
		"AI is off: set AI_BASE_URL and AI_MODEL (and AI_API_KEY if the model server needs one).",
		2,
	);

const provider = createOpenAICompatibleProvider({
	baseUrl: ai.baseUrl,
	apiKey: ai.apiKey,
	model: ai.model,
	jsonMode: ai.jsonMode,
	fetch,
});
let done = 0;
const results = await runAiEval({
	provider,
	jsonMode: ai.jsonMode,
	count,
	kinds,
	timeoutMs: Math.max(ai.timeoutMs, ai.translateTimeoutMs),
	onResult: (result: EvalCaseResult) => {
		done++;
		if (done % 10 === 0) console.error(`… ${done} cases`);
		if (result.error) console.error(`  ${result.group}: ${result.error} (${result.ms} ms)`);
	},
});
const summary = summarize(results);
const pct = (n: number, of: number) => `${Math.round((100 * n) / Math.max(1, of))}%`.padStart(5);
console.log(`model ${ai.model} at ${new URL(ai.baseUrl).host}, json mode ${ai.jsonMode}`);
console.log("group                        cases  json usable  lang?  lang✗    p50 ms   p95 ms");
for (const g of summary) {
	console.log(
		`${g.group.padEnd(28)} ${String(g.cases).padStart(5)} ${pct(g.json, g.cases)} ${pct(g.usable, g.cases)} ${pct(g.languageMatch, g.cases)} ${pct(g.languageMismatch, g.cases)} ${String(g.p50Ms).padStart(9)} ${String(g.p95Ms).padStart(8)}`,
	);
}
if (out) {
	await Bun.write(
		out,
		JSON.stringify(
			{ model: ai.model, jsonMode: ai.jsonMode, at: new Date().toISOString(), summary },
			null,
			2,
		),
	);
	console.error(`Report written to ${out}`);
}
