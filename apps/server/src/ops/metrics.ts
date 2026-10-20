/**
 * Content-free Prometheus metrics (Annex C §1.10), kept in this process's
 * memory (one instance per database) and served as text by
 * `GET /internal/metrics` when `METRICS_TOKEN` is set.
 *
 * Label values are machine tags only (route templates, procedure kinds,
 * outcomes, limiter scopes, Stripe event types): never a user id, an email,
 * a hash, a token or any text a user typed. `labelValue` refuses anything
 * else, and each metric keeps at most `MAX_SERIES` label combinations, so a
 * bug upstream can neither leak content nor grow memory without bound.
 */

/** One label set beyond this many per metric folds into `other`. */
export const MAX_SERIES = 500;

/** A label value: letters, digits and `_.:/*-`, at most 80 characters; anything else is `other`. */
export function labelValue(value: unknown): string {
	const text = typeof value === "number" ? String(value) : value;
	if (typeof text !== "string" || !text) return "none";
	return /^[\w.:/*-]{1,80}$/.test(text) ? text : "other";
}

function escapeLabel(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function formatLabels(names: readonly string[], values: readonly string[], extra = ""): string {
	const pairs = names.map((name, i) => `${name}="${escapeLabel(values[i] ?? "")}"`);
	if (extra) pairs.push(extra);
	return pairs.length ? `{${pairs.join(",")}}` : "";
}

function formatNumber(value: number): string {
	if (value === Number.POSITIVE_INFINITY) return "+Inf";
	return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

class Series<T> {
	private readonly entries = new Map<string, { values: string[]; state: T }>();

	constructor(
		readonly labelNames: readonly string[],
		private readonly init: () => T,
	) {}

	get(values: readonly unknown[]): T {
		const clean = this.labelNames.map((_, i) => labelValue(values[i]));
		let key = clean.join("\u0000");
		let entry = this.entries.get(key);
		if (!entry) {
			if (this.entries.size >= MAX_SERIES) {
				const other = this.labelNames.map(() => "other");
				key = other.join("\u0000");
				entry = this.entries.get(key);
				if (!entry) {
					entry = { values: other, state: this.init() };
					this.entries.set(key, entry);
				}
				return entry.state;
			}
			entry = { values: clean, state: this.init() };
			this.entries.set(key, entry);
		}
		return entry.state;
	}

	*all(): Iterable<{ values: string[]; state: T }> {
		yield* [...this.entries.values()].sort((a, b) =>
			a.values.join("\u0000").localeCompare(b.values.join("\u0000")),
		);
	}
}

export class Counter {
	private readonly series: Series<{ value: number }>;

	constructor(
		readonly name: string,
		readonly help: string,
		labelNames: readonly string[] = [],
	) {
		this.series = new Series(labelNames, () => ({ value: 0 }));
	}

	inc(labels: readonly unknown[] = [], by = 1): void {
		if (!Number.isFinite(by) || by <= 0) return;
		this.series.get(labels).value += by;
	}

	render(): string[] {
		const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
		for (const { values, state } of this.series.all()) {
			lines.push(
				`${this.name}${formatLabels(this.series.labelNames, values)} ${formatNumber(state.value)}`,
			);
		}
		return lines;
	}
}

export class Histogram {
	private readonly series: Series<{ counts: number[]; sum: number; count: number }>;

	constructor(
		readonly name: string,
		readonly help: string,
		readonly buckets: readonly number[],
		labelNames: readonly string[] = [],
	) {
		this.series = new Series(labelNames, () => ({
			counts: buckets.map(() => 0),
			sum: 0,
			count: 0,
		}));
	}

	observe(labels: readonly unknown[], value: number): void {
		if (!Number.isFinite(value) || value < 0) return;
		const state = this.series.get(labels);
		state.sum += value;
		state.count++;
		for (let i = 0; i < this.buckets.length; i++) {
			if (value <= (this.buckets[i] as number)) (state.counts[i] as number)++;
		}
	}

	render(): string[] {
		const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
		const names = this.series.labelNames;
		for (const { values, state } of this.series.all()) {
			this.buckets.forEach((bound, i) => {
				lines.push(
					`${this.name}_bucket${formatLabels(names, values, `le="${formatNumber(bound)}"`)} ${state.counts[i]}`,
				);
			});
			lines.push(`${this.name}_bucket${formatLabels(names, values, 'le="+Inf"')} ${state.count}`);
			lines.push(`${this.name}_sum${formatLabels(names, values)} ${formatNumber(state.sum)}`);
			lines.push(`${this.name}_count${formatLabels(names, values)} ${state.count}`);
		}
		return lines;
	}
}

/** A gauge read at scrape time (`atomic_users`, `atomic_pro_users`). */
export interface GaugeValue {
	name: string;
	help: string;
	value: number;
	labels?: Record<string, string>;
}

const HTTP_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000];
const AI_BUCKETS_MS = [250, 500, 1000, 2500, 5000, 10_000, 15_000, 25_000, 45_000, 90_000, 240_000];

/**
 * What the server counts (Annex C §1.10). Every method takes machine tags
 * and numbers only.
 */
export interface Metrics {
	/** One finished HTTP request: its route template, status and duration. */
	request(route: string, status: number, ms: number): void;
	/** Records received by `sync.push` (accepted or not). */
	syncPushed(records: number): void;
	/** One AI call: the suggestion kind (or `translate`), its outcome and duration. */
	ai(kind: string, outcome: string, ms: number): void;
	/** Output tokens the model produced (capacity planning). */
	aiTokensOut(tokens: number): void;
	/** Bytes of one accepted photo upload. */
	blobUploaded(bytes: number): void;
	/** One request or message refused by a rate limit or throttle (`scope` is a fixed name). */
	rateLimited(scope: string): void;
	/** One verified Stripe webhook event, by type. */
	billingWebhook(type: string): void;
	/** One maintenance step: `ok` or `failed`. */
	maintenance(step: string, outcome: "ok" | "failed"): void;
	/** The Prometheus text exposition (version 0.0.4), gauges appended. */
	render(gauges?: readonly GaugeValue[]): string;
}

export function createMetrics(version: string): Metrics {
	const httpRequests = new Counter(
		"atomic_http_requests_total",
		"HTTP requests by route template and status.",
		["route", "status"],
	);
	const httpDuration = new Histogram(
		"atomic_http_duration_ms",
		"HTTP request duration in milliseconds, by route template.",
		HTTP_BUCKETS_MS,
		["route"],
	);
	const syncPushed = new Counter(
		"atomic_sync_records_pushed_total",
		"Records received by sync.push.",
	);
	const aiRequests = new Counter(
		"atomic_ai_requests_total",
		"AI calls by kind (translate for translations) and outcome.",
		["kind", "outcome"],
	);
	const aiLatency = new Histogram(
		"atomic_ai_latency_ms",
		"AI call duration in milliseconds (queue wait and every attempt), by kind.",
		AI_BUCKETS_MS,
		["kind"],
	);
	const aiTokens = new Counter(
		"atomic_ai_tokens_out_total",
		"Output tokens produced by the model.",
	);
	const blobBytes = new Counter(
		"atomic_blob_bytes_uploaded_total",
		"Bytes of accepted photo uploads.",
	);
	const rateLimited = new Counter(
		"atomic_rate_limited_total",
		"Requests refused by a rate limit or throttle, by scope.",
		["scope"],
	);
	const webhooks = new Counter(
		"atomic_billing_webhooks_total",
		"Verified Stripe webhook events, by type.",
		["type"],
	);
	const maintenance = new Counter(
		"atomic_maintenance_steps_total",
		"Maintenance steps by name and outcome.",
		["step", "outcome"],
	);
	const started = Date.now();

	return {
		request(route, status, ms) {
			httpRequests.inc([route, status]);
			httpDuration.observe([route], ms);
		},
		syncPushed(records) {
			syncPushed.inc([], records);
		},
		ai(kind, outcome, ms) {
			aiRequests.inc([kind, outcome]);
			aiLatency.observe([kind], ms);
		},
		aiTokensOut(tokens) {
			aiTokens.inc([], tokens);
		},
		blobUploaded(bytes) {
			blobBytes.inc([], bytes);
		},
		rateLimited(scope) {
			rateLimited.inc([scope]);
		},
		billingWebhook(type) {
			webhooks.inc([type]);
		},
		maintenance(step, outcome) {
			maintenance.inc([step, outcome]);
		},
		render(gauges = []) {
			const lines = [
				"# HELP atomic_build_info The running server version.",
				"# TYPE atomic_build_info gauge",
				`atomic_build_info{version="${escapeLabel(labelValue(version))}"} 1`,
				"# HELP atomic_process_start_time_seconds When this process started (Unix time).",
				"# TYPE atomic_process_start_time_seconds gauge",
				`atomic_process_start_time_seconds ${Math.floor(started / 1000)}`,
			];
			for (const metric of [
				httpRequests,
				httpDuration,
				syncPushed,
				aiRequests,
				aiLatency,
				aiTokens,
				blobBytes,
				rateLimited,
				webhooks,
				maintenance,
			]) {
				lines.push(...metric.render());
			}
			for (const gauge of gauges) {
				const names = Object.keys(gauge.labels ?? {});
				const values = names.map((name) => labelValue(gauge.labels?.[name]));
				lines.push(`# HELP ${gauge.name} ${gauge.help}`, `# TYPE ${gauge.name} gauge`);
				lines.push(`${gauge.name}${formatLabels(names, values)} ${formatNumber(gauge.value)}`);
			}
			return `${lines.join("\n")}\n`;
		},
	};
}

/** Counts nothing (scripts and tests that don't look). */
export const noopMetrics: Metrics = {
	request() {},
	syncPushed() {},
	ai() {},
	aiTokensOut() {},
	blobUploaded() {},
	rateLimited() {},
	billingWebhook() {},
	maintenance() {},
	render: () => "",
};
