import type { Translator } from "@atomic/core";
import { useEffect, useState } from "react";

/**
 * Formatting for the account screens (sizes, dates, servers). Sizes use
 * international unit symbols (KB, MB, GB) with the locale's decimal mark.
 * Owner: T5.
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
export function formatDate(timestamp: number, locale: string, now = Date.now()): string {
	const date = new Date(timestamp);
	const sameYear = date.getFullYear() === new Date(now).getFullYear();
	try {
		return new Intl.DateTimeFormat(locale, {
			day: "numeric",
			month: "short",
			...(sameYear ? {} : { year: "numeric" }),
		}).format(date);
	} catch {
		return date.toLocaleDateString();
	}
}

/** "9:00 PM" / "21:00" ("00:00", not "0:00", where the clock runs to 24 hours). */
export function formatClock(timestamp: number, locale: string): string {
	try {
		const cycle = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle;
		const hour = cycle === "h23" || cycle === "h24" ? "2-digit" : "numeric";
		return new Intl.DateTimeFormat(locale, { hour, minute: "2-digit" }).format(new Date(timestamp));
	} catch {
		return new Date(timestamp).toLocaleTimeString();
	}
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

/** "Atomic Cloud" for the official server, else the host ("sync.example.com"). */
export function serverName(
	url: string | null | undefined,
	official: string | null,
	officialLabel: string,
): string {
	if (!url) return officialLabel;
	if (official && url === official) return officialLabel;
	try {
		return new URL(url).host || url;
	} catch {
		return url;
	}
}

/** Re-renders every `everyMs` (relative times like "2 minutes ago" stay current). */
export function useNow(everyMs = 30_000): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), everyMs);
		return () => window.clearInterval(id);
	}, [everyMs]);
	return now;
}
