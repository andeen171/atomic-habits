import { type Locale, createTranslator } from "@atomic/core";
import { type SafeHtml, html, raw, renderPage } from "../lib/html";

/**
 * The server-rendered account pages (spec §4.3, Annex C §6.4): the password
 * reset form, the "email confirmed" page and the expired-link messages.
 * Localized from the core `page.*` keys; no script, labelled inputs, errors
 * announced with `role="alert"`.
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export type ResetFormError = "mismatch" | "tooShort" | "tooLong";

export function resetFormPage(
	locale: Locale,
	input: { token: string; error?: ResetFormError },
): string {
	const t = createTranslator(locale);
	const error =
		input.error === "mismatch"
			? t.t("page.reset.mismatch")
			: input.error === "tooShort"
				? t.t("page.reset.tooShort", { min: PASSWORD_MIN })
				: input.error === "tooLong"
					? t.t("page.reset.tooLong", { max: PASSWORD_MAX })
					: null;
	const invalid = error ? raw(' aria-invalid="true" aria-describedby="error"') : raw("");
	const body = html`<form method="post" action="reset-password" novalidate>
<input type="hidden" name="token" value="${input.token}">
<input type="hidden" name="lang" value="${locale}">
<label for="password">${t.t("page.reset.password")}</label>
<input id="password" name="password" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN}" maxlength="${PASSWORD_MAX}" required aria-describedby="hint"${invalid}>
<p class="hint" id="hint">${t.t("page.reset.hint", { min: PASSWORD_MIN })}</p>
<label for="confirm">${t.t("page.reset.confirm")}</label>
<input id="confirm" name="confirm" type="password" autocomplete="new-password" minlength="${PASSWORD_MIN}" maxlength="${PASSWORD_MAX}" required${invalid}>
${error ? html`<p class="alert" id="error" role="alert">${error}</p>` : raw("")}
<button class="button" type="submit">${t.t("page.reset.submit")}</button>
</form>`;
	return renderPage({ locale, title: t.t("page.reset.title"), body });
}

/** A heading, one paragraph and an optional "Open Atomic" link. */
export function messagePage(
	locale: Locale,
	input: { title: string; text: string; openAppUrl?: string | null },
): string {
	const t = createTranslator(locale);
	const action: SafeHtml = input.openAppUrl
		? html`<a class="button" href="${input.openAppUrl}">${t.t("page.openApp")}</a>`
		: raw("");
	return renderPage({
		locale,
		title: input.title,
		body: html`<p>${input.text}</p>${action}`,
	});
}

export function resetDonePage(locale: Locale): string {
	const t = createTranslator(locale);
	return messagePage(locale, { title: t.t("page.reset.title"), text: t.t("page.reset.done") });
}

export function resetInvalidPage(locale: Locale): string {
	const t = createTranslator(locale);
	return messagePage(locale, { title: t.t("page.linkExpired"), text: t.t("page.reset.invalid") });
}

export function verifiedPage(
	locale: Locale,
	input: { ok: boolean; openAppUrl?: string | null },
): string {
	const t = createTranslator(locale);
	return input.ok
		? messagePage(locale, {
				title: t.t("page.verified.title"),
				text: t.t("page.verified.body"),
				openAppUrl: input.openAppUrl,
			})
		: messagePage(locale, {
				title: t.t("page.linkExpired"),
				text: t.t("page.verified.failed"),
				openAppUrl: input.openAppUrl,
			});
}

export function exportInvalidPage(locale: Locale): string {
	const t = createTranslator(locale);
	return messagePage(locale, { title: t.t("page.linkExpired"), text: t.t("page.export.invalid") });
}

export function tooManyPage(locale: Locale): string {
	const t = createTranslator(locale);
	return messagePage(locale, { title: "Atomic", text: t.t("page.tooMany") });
}
