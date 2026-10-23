import {
	GrantError,
	grantPlan,
	listGrants,
	parseDuration,
	parsePlan,
	revokeGrants,
} from "../src/admin/grant";
import { fail, openScript, takeFlag } from "./_cli";

/**
 * Give a plan by hand (spec §4.5), e.g. to a beta tester:
 *
 *   bun run scripts/grant.ts <email> <plan> <duration> "<reason>"
 *   bun run scripts/grant.ts ana@example.com pro 90d "beta tester"
 *   bun run scripts/grant.ts ana@example.com pro forever "founder"
 *   bun run scripts/grant.ts --list ana@example.com
 *   bun run scripts/grant.ts --revoke ana@example.com
 *
 * Durations: <n>h, <n>d, <n>w or forever. A paid subscription always wins
 * over a grant. The running server picks the change up within a minute
 * (its plan cache). In Docker: `docker compose exec server bun run scripts/grant.ts …`.
 */

const usage = `usage:
  bun run scripts/grant.ts <email> <free|pro> <90d|12w|48h|forever> "<reason>"
  bun run scripts/grant.ts --list <email>
  bun run scripts/grant.ts --revoke <email>`;

const args = process.argv.slice(2);
const list = takeFlag(args, "--list");
const revoke = takeFlag(args, "--revoke");
if (takeFlag(args, "--help") || takeFlag(args, "-h")) fail(usage, 0);
if ((list || revoke) && args.length !== 1) fail(usage, 2);
if (!list && !revoke && args.length !== 4) fail(usage, 2);

const date = (ms: number | null) => (ms === null ? "never" : new Date(ms).toISOString());

const { db, close } = openScript();
try {
	const now = Date.now();
	const [email = ""] = args;
	if (list) {
		const rows = await listGrants(db, email, now);
		if (!rows.length) console.log("No grants.");
		for (const row of rows) {
			console.log(
				`${row.active ? "active " : "ended  "} ${row.plan.padEnd(4)} until ${date(row.expiresAt)}  given ${date(row.createdAt)}  ${row.reason}  (${row.id})`,
			);
		}
	} else if (revoke) {
		const ended = await revokeGrants(db, email, now);
		console.log(`Ended ${ended} active grant(s). The server applies it within a minute.`);
	} else {
		const [, planText = "", durationText = "", reason = ""] = args;
		const result = await grantPlan(db, {
			email,
			plan: parsePlan(planText),
			durationMs: parseDuration(durationText),
			reason,
			now,
		});
		console.log(
			`Granted ${planText.toLowerCase()} until ${date(result.expiresAt)} (grant ${result.grantId}). The server applies it within a minute.`,
		);
	}
} catch (error) {
	if (error instanceof GrantError) fail(error.message, 1);
	throw error;
} finally {
	close();
}
