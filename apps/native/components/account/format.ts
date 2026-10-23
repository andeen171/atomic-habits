import { type Translator, normalizeServerUrl, toDayKey } from "@atomic/core";
import { useEffect, useState } from "react";

/**
 * Formatting for the account screens (sizes, dates, servers), the same
 * rules as the web app. Sizes use international unit symbols (KB, MB, GB)
 * with the locale's decimal mark. Owner: T5.
 */

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** "0 B", "840 KB", "23 MB", "1.5 GB" / "1,5 GB". */
export function formatBytes(bytes: number, t: Pick<Translator, "number">): string {
	let value = Math.max(0, bytes);
	let unit = 0;
	while (value >= 1024 && unit < UNITS.length - 1) {
		value /= 1024;
		unit++;
	}
	// One decimal below 10 of a unit ("1.5 GB"), none when it rounds to a whole number.
	const tenths = Math.round(value * 10) / 10;
	const digits = unit > 0 && tenths < 10 && !Number.isInteger(tenths) ? 1 : 0;
	return `${t.number(digits ? tenths : Math.round(value), digits)} ${UNITS[unit]}`;
}

/** "Oct 17" this year, "Oct 17, 2027" otherwise (locale order). */
export function formatDate(
	timestamp: number,
	t: Pick<Translator, "locale" | "formatDayShort">,
	now = Date.now(),
): string {
	const date = new Date(timestamp);
	const sameYear = date.getFullYear() === new Date(now).getFullYear();
	try {
		return new Intl.DateTimeFormat(t.locale, {
			day: "numeric",
			month: "short",
			...(sameYear ? {} : { year: "numeric" }),
		}).format(date);
	} catch {
		const day = t.formatDayShort(toDayKey(date));
		return sameYear ? day : `${day} ${date.getFullYear()}`;
	}
}

/** "9:00 PM" / "21:00" ("00:00" and "09:00", not "0:00", where the clock runs to 24 hours). */
export function formatClock(timestamp: number, locale: string): string {
	const date = new Date(timestamp);
	let text: string;
	try {
		text = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
	} catch {
		text = `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
	}
	// A bare one-digit hour (no AM/PM) is a 24-hour clock: pad it, whatever the engine's Intl does.
	return /^\d:\d\d$/.test(text) ? `0${text}` : text;
}

/** Up to two initials from the name, else the email's first letter. */
export function initialsOf(name: string, email: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const letters =
		words.length >= 2
			? `${words[0]?.[0] ?? ""}${words[words.length - 1]?.[0] ?? ""}`
			: (words[0]?.slice(0, 1) ?? email.trim().slice(0, 1));
	return (letters || "?").toLocaleUpperCase();
}

/** The host of a server URL ("sync.example.com"), or the URL itself. */
function hostOf(url: string): string {
	const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url);
	return match?.[1] ?? url;
}

/** "Atomic Cloud" for the official server, else the host ("sync.example.com"). */
export function serverName(
	url: string | null | undefined,
	official: string | null,
	officialLabel: string,
): string {
	if (!url) return officialLabel;
	if (official && url === official) return officialLabel;
	return hostOf(url);
}

/** Dot-separated labels of letters, digits and hyphens (IPv4 too). */
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;

/**
 * A usable server address ("https://…" added when missing), or null: an
 * http(s) URL whose host is a domain, an IP address (IPv6 in brackets) or
 * `localhost`.
 */
export function validServerUrl(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed || /\s/.test(trimmed)) return null;
	const url = normalizeServerUrl(trimmed);
	const match = /^(https?):\/\/(\[[0-9a-f:.]+\]|[^/?#:]+)(:\d{1,5})?(\/[^?#]*)?$/i.exec(url);
	if (!match) return null;
	const host = match[2] ?? "";
	if (host.startsWith("[")) return url;
	// Dot-separated labels of letters, digits and hyphens (IPv4 too), or `localhost`.
	if (!HOST.test(host)) return null;
	if (!host.includes(".") && host !== "localhost") return null;
	return url;
}

/** Re-renders every `everyMs` (relative times like "2 minutes ago" stay current). */
export function useNow(everyMs = 30_000): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), everyMs);
		return () => clearInterval(id);
	}, [everyMs]);
	return now;
}
