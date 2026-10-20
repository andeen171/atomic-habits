import type { EmailConfig } from "../config";
import { type Logger, safeTag } from "./log";
import type { RateLimiter } from "./rate-limit";

/**
 * Transactional email (spec §4.5, D30): Resend over HTTP when configured,
 * printed to the console in development (`EMAIL_PROVIDER=console`), and off
 * otherwise (verification and reset are then disabled entirely).
 *
 * Throttles: at most 3 messages per recipient per hour and `EMAIL_DAILY_CAP`
 * per UTC day (below Resend's free 100/day). A third of the daily cap is
 * kept for password resets: verification emails stop once only that
 * reserve is left, so a wave of junk sign-ups (5 per hour per IP) can delay
 * new accounts' verification to the next day, but never lock a user out of
 * a reset. A throttled message is dropped, logged as `email.capped` and
 * counted (`atomic_rate_limited_total{scope="email.<reason>"}`); the
 * endpoint that asked for it still answers 200, so the response never tells
 * whether an account exists.
 *
 * Logs carry the tag and the status only: never the recipient, the subject,
 * the link or the body.
 */

export type EmailTag = "verify" | "reset";

export interface EmailMessage {
	to: string;
	subject: string;
	html: string;
	text: string;
	tag: EmailTag;
}

export type EmailOutcome = "sent" | "capped" | "failed";

export interface EmailService {
	/** Sends unless a throttle applies. Never throws. */
	send(message: EmailMessage): Promise<EmailOutcome>;
	/**
	 * Sends in the background: auth endpoints answer without waiting for the
	 * provider (constant time whether or not the account exists).
	 */
	dispatch(message: EmailMessage): void;
	/** Resolves once every dispatched message settled (tests, shutdown). */
	idle(): Promise<void>;
}

export const RESEND_URL = "https://api.resend.com/emails";
export const EMAIL_TIMEOUT_MS = 10_000;
/** Per recipient per hour (spec §4.5). */
export const EMAIL_RECIPIENT_LIMIT = { max: 3, windowMs: 60 * 60 * 1000 } as const;

/** The part of `EMAIL_DAILY_CAP` only password resets may use. */
export function resetReserve(dailyCap: number): number {
	return Math.floor(dailyCap / 3);
}

const DAY_MS = 86_400_000;

export interface EmailDeps {
	config: EmailConfig;
	fetch: typeof fetch;
	now: () => number;
	log: Logger;
	limiter: RateLimiter;
	/** Where `EMAIL_PROVIDER=console` prints (development only). */
	print?: (line: string) => void;
	/**
	 * Called for each message the daily budget refuses (metrics). The
	 * per-recipient refusals are counted by the rate limiter itself.
	 */
	onCapped?: (reason: "daily" | "reserved") => void;
}

export function createEmailService(deps: EmailDeps): EmailService {
	const { config, log, limiter, now } = deps;
	let daily = { day: -1, count: 0 };
	const inflight = new Set<Promise<unknown>>();

	/** The provider call itself; returns an HTTP status or a short failure tag. */
	const deliver = async (message: EmailMessage): Promise<number | string> => {
		if (config.provider === "console") {
			// Development only (refused in production): the link is the point.
			(deps.print ?? console.info)(
				`[email:console] ${message.tag} to=${message.to}\n${message.subject}\n\n${message.text}`,
			);
			return 200;
		}
		try {
			const response = await deps.fetch(RESEND_URL, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${config.resendApiKey ?? ""}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					from: config.from,
					to: [message.to],
					subject: message.subject,
					html: message.html,
					text: message.text,
					tags: [{ name: "category", value: message.tag }],
				}),
				signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
			});
			// Drain without reading it into a log.
			await response.body?.cancel().catch(() => {});
			return response.status;
		} catch (error) {
			const name = (error as Error)?.name;
			return name === "TimeoutError" || name === "AbortError"
				? "timeout"
				: (safeTag(name) ?? "network");
		}
	};

	const capped = (message: EmailMessage, reason: "daily" | "reserved" | "recipient") => {
		log.warn({ msg: "email.capped", tag: message.tag, reason });
		if (reason !== "recipient") deps.onCapped?.(reason);
		return "capped" as const;
	};

	const send = async (message: EmailMessage): Promise<EmailOutcome> => {
		const day = Math.floor(now() / DAY_MS);
		if (daily.day !== day) daily = { day, count: 0 };
		if (daily.count >= config.dailyCap) return capped(message, "daily");
		if (message.tag !== "reset" && daily.count >= config.dailyCap - resetReserve(config.dailyCap)) {
			return capped(message, "reserved");
		}
		const recipient = limiter.hit(
			"email.recipient",
			message.to.trim().toLowerCase(),
			EMAIL_RECIPIENT_LIMIT.max,
			EMAIL_RECIPIENT_LIMIT.windowMs,
		);
		if (!recipient.ok) return capped(message, "recipient");
		daily.count++;
		const status = await deliver(message);
		const ok = typeof status === "number" && status >= 200 && status < 300;
		if (ok) log.info({ msg: "email", tag: message.tag, status });
		else log.warn({ msg: "email", tag: message.tag, status });
		return ok ? "sent" : "failed";
	};

	return {
		send,
		dispatch(message) {
			const job = send(message).catch(() => "failed");
			inflight.add(job);
			void job.finally(() => inflight.delete(job));
		},
		async idle() {
			while (inflight.size) await Promise.allSettled([...inflight]);
		},
	};
}
