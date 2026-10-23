import { type Locale, createTranslator, palettes } from "@atomic/core";
import { type SafeHtml, html, raw } from "../lib/html";

/**
 * Transactional emails (spec §4.5, Annex C §6.5): HTML and plain text from
 * the core `email.*` keys, in the recipient's language. Inline styles only
 * (mail clients drop `<style>`), light palette (most clients force it).
 */

export interface RenderedEmail {
	subject: string;
	html: string;
	text: string;
}

const P = palettes.light;
const FONT = "system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * A display name safe to put in an email: anyone can sign up with someone
 * else's address, so a name that looks like a link or an address (a phishing
 * line in the victim's inbox) falls back to the address' own local part.
 */
export function greetingName(name: string, email: string): string {
	const clean = [...name]
		.filter((char) => {
			const code = char.charCodeAt(0);
			return code >= 0x20 && (code < 0x7f || code > 0x9f);
		})
		.join("")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 40)
		.trim();
	const linkLike = /[@/\\:]|www\.|\.[a-z]{2,}\b/i.test(clean);
	if (clean && !linkLike) return clean;
	return email.split("@")[0]?.slice(0, 40) || email;
}

function layout(options: {
	locale: Locale;
	subject: string;
	body: string;
	cta: string;
	url: string;
	/** Shown before the button, so it is read before anyone clicks. */
	warning?: string;
	fallback: string;
	footer: string;
}): RenderedEmail {
	const p = (text: string, style = "") =>
		html`<p style="${raw(`margin:0 0 16px;line-height:1.5;${style}`)}">${text}</p>`;
	const button: SafeHtml = html`<p style="margin:24px 0"><a href="${options.url}" style="${raw(
		`display:inline-block;padding:12px 20px;border-radius:10px;background:${P.accent};color:${P.onAccent};font-weight:600;text-decoration:none`,
	)}">${options.cta}</a></p>`;
	const page = html`<!doctype html><html lang="${options.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${options.subject}</title></head><body style="${raw(
		`margin:0;padding:24px 12px;background:${P.bg};color:${P.text};font-family:${FONT}`,
	)}"><div style="${raw(
		`max-width:480px;margin:0 auto;background:${P.surface};border:1px solid ${P.border};border-radius:16px;padding:28px 24px`,
	)}">${p("Atomic", `font-weight:700;color:${P.accentText}`)}${p(options.body)}${
		options.warning ? p(options.warning, "font-weight:600") : raw("")
	}${button}${p(options.fallback, `font-size:13px;color:${P.textMuted}`)}${p(
		options.url,
		`font-size:13px;color:${P.textMuted};word-break:break-all`,
	)}<hr style="${raw(`border:0;border-top:1px solid ${P.border};margin:24px 0 16px`)}">${p(
		options.footer,
		`font-size:12px;color:${P.textMuted};margin:0`,
	)}</div></body></html>`;
	const text = [
		options.body,
		...(options.warning ? [options.warning] : []),
		`${options.cta}: ${options.url}`,
		"--",
		options.footer,
	].join("\n\n");
	return { subject: options.subject, html: page.html, text };
}

/**
 * "Confirm your email": sent on sign-up and on "Resend" (when email is on).
 * Anyone can sign up with someone else's address, so the email says, before
 * the button, that confirming an account you didn't create hands it to
 * whoever did (the link guard only reclaims unverified accounts).
 */
export function verificationEmail(
	locale: Locale,
	input: { name: string; email: string; url: string },
): RenderedEmail {
	const t = createTranslator(locale);
	return layout({
		locale,
		subject: t.t("email.verify.subject"),
		body: t.t("email.verify.body", { name: greetingName(input.name, input.email) }),
		cta: t.t("email.verify.cta"),
		url: input.url,
		warning: t.t("email.verify.ignore"),
		fallback: t.t("email.linkFallback"),
		footer: t.t("email.footer"),
	});
}

/** "Reset your password": links to the server's own reset page. */
export function resetEmail(locale: Locale, input: { email: string; url: string }): RenderedEmail {
	const t = createTranslator(locale);
	return layout({
		locale,
		subject: t.t("email.reset.subject"),
		body: t.t("email.reset.body", { email: input.email }),
		cta: t.t("email.reset.cta"),
		url: input.url,
		fallback: t.t("email.linkFallback"),
		footer: t.t("email.footer"),
	});
}
