import { type Locale, type Palette, palettes } from "@atomic/core";

/**
 * Server-rendered HTML (account pages, emails): escaping and one layout that
 * follows the core light and dark palettes through `prefers-color-scheme`.
 * Pages carry no script and load nothing; their headers forbid framing,
 * referrers and caching (spec §4.3, D55).
 */

const ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

/** Text and attribute values: escape everything HTML could interpret. */
export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** Markup that is already safe (built from escaped parts). */
export interface SafeHtml {
	readonly html: string;
}

export function raw(html: string): SafeHtml {
	return { html };
}

/** `html\`<p>${text}</p>\``: interpolated strings are escaped, `SafeHtml` is kept. */
export function html(strings: TemplateStringsArray, ...values: (string | number | SafeHtml)[]) {
	let out = strings[0] ?? "";
	values.forEach((value, i) => {
		out += typeof value === "object" ? value.html : escapeHtml(String(value));
		out += strings[i + 1] ?? "";
	});
	return raw(out);
}

export function join(parts: readonly SafeHtml[]): SafeHtml {
	return raw(parts.map((part) => part.html).join(""));
}

/** No script, no external loads, no framing; forms post back here only. */
export const PAGE_CSP =
	"default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/**
 * Headers of every account page and token response: tokens travel in these
 * URLs, so nothing may cache them or leak them in a `Referer`.
 */
export const PAGE_HEADERS: Readonly<Record<string, string>> = {
	"Content-Type": "text/html; charset=utf-8",
	"Content-Security-Policy": PAGE_CSP,
	"Referrer-Policy": "no-referrer",
	"Cache-Control": "no-store",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
};

function cssVars(p: Palette): string {
	return [
		`--bg:${p.bg}`,
		`--surface:${p.surface}`,
		`--sunken:${p.sunken}`,
		`--border:${p.border}`,
		`--border-strong:${p.borderStrong}`,
		`--text:${p.text}`,
		`--muted:${p.textMuted}`,
		`--accent:${p.accent}`,
		`--accent-text:${p.accentText}`,
		`--on-accent:${p.onAccent}`,
		`--success:${p.success}`,
		`--danger:${p.danger}`,
		`--danger-soft:${p.dangerSoft}`,
		`--ring:${p.ring}`,
	].join(";");
}

const PAGE_STYLE = [
	`:root{color-scheme:light dark;${cssVars(palettes.light)}}`,
	`@media (prefers-color-scheme:dark){:root{${cssVars(palettes.dark)}}}`,
	"*{box-sizing:border-box}",
	"body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}",
	"main{width:100%;max-width:420px;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px 24px}",
	".brand{margin:0 0 16px;font-weight:700;color:var(--accent-text)}",
	"h1{font-size:1.375rem;line-height:1.3;margin:0 0 12px}",
	"p{margin:0 0 12px;color:var(--muted)}",
	"label{display:block;font-weight:600;margin:16px 0 6px}",
	"input{width:100%;font:inherit;padding:10px 12px;border-radius:10px;border:1px solid var(--border-strong);background:var(--sunken);color:var(--text)}",
	"input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--ring);outline-offset:2px}",
	".hint{font-size:.875rem;margin:6px 0 0}",
	".alert{margin:16px 0 0;padding:10px 12px;border-radius:10px;background:var(--danger-soft);color:var(--danger)}",
	".button{display:block;margin-top:20px;width:100%;padding:12px 16px;border:0;border-radius:10px;background:var(--accent);color:var(--on-accent);font:inherit;font-weight:600;text-align:center;text-decoration:none;cursor:pointer}",
].join("");

/**
 * A complete page: `<html lang>`, one centred card, the brand and a heading.
 * `head` adds escaped markup to `<head>` (the billing return page's
 * `<meta http-equiv="refresh">` into the app; pages never carry script).
 */
export function renderPage(options: {
	locale: Locale;
	title: string;
	body: SafeHtml;
	head?: SafeHtml;
}): string {
	return `<!doctype html>${
		html`<html lang="${options.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">${options.head ?? raw("")}<title>${options.title} · Atomic</title><style>${raw(PAGE_STYLE)}</style></head><body><main><p class="brand">Atomic</p><h1>${options.title}</h1>${options.body}</main></body></html>`
			.html
	}`;
}

/** An HTML response with the page headers. */
export function htmlResponse(page: string, status = 200, headers: Record<string, string> = {}) {
	return new Response(page, { status, headers: { ...PAGE_HEADERS, ...headers } });
}
