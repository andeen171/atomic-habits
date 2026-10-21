/**
 * v2 strings for server pages and emails (email.*, page.*) (spec §7). Owner: T6. Copy source: Annex C §7.
 * Spread into `en.ts`; every key also lives in `server.pt-BR.ts`.
 */
export const serverEn = {
	// Emails (Annex C §7). `{name}` and `{email}` are the recipient's own.
	"email.verify.subject": "Confirm your email for Atomic",
	"email.verify.body":
		"Hi {name}, confirm this is your email so you can always recover your account.",
	"email.verify.cta": "Confirm email",
	"email.verify.ignore":
		"Didn't create an Atomic account? Don't confirm: someone may have used your address, and confirming would hand them an account in your name. Just ignore this email.",
	"email.reset.subject": "Reset your Atomic password",
	"email.reset.body":
		"Someone asked to reset the password for {email}. The link expires in 1 hour. If it wasn't you, ignore this email.",
	"email.reset.cta": "Choose a new password",
	"email.linkFallback": "If the button doesn't work, copy this link into your browser:",
	"email.footer":
		"You're receiving this because of your Atomic account. Atomic never asks for your password by email.",
	// Server-rendered pages (Annex C §7, spec §4.3).
	"page.reset.title": "Choose a new password",
	"page.reset.password": "New password",
	"page.reset.confirm": "Repeat the new password",
	"page.reset.hint": "At least {min} characters.",
	"page.reset.mismatch": "The passwords don't match.",
	"page.reset.tooShort": "Use at least {min} characters.",
	"page.reset.tooLong": "Use at most {max} characters.",
	"page.reset.submit": "Save new password",
	"page.reset.done": "Password changed. Sign in again on your devices.",
	"page.reset.invalid": "This link expired or was already used. Request a new one from the app.",
	"page.verified.title": "Email confirmed",
	"page.verified.body": "You can go back to Atomic.",
	"page.verified.failed": "This link expired. Send a new one from the app.",
	"page.export.invalid":
		"This download link expired or was already used. Request a new one from the app.",
	"page.linkExpired": "Link expired",
	"page.tooMany": "Too many attempts. Try again in a minute.",
	"page.billing.success": "Payment received. Your plan updates in a few seconds.",
	"page.billing.cancel": "Checkout canceled. Nothing was charged.",
	"page.billing.title": "Atomic Pro",
	"page.billing.portal": "Any change to your plan shows up in Atomic in a few seconds.",
	"page.billing.backToApp": "Go back to Atomic to see your plan.",
	"page.openApp": "Open Atomic",
	"page.close": "You can close this tab.",
} as const;
