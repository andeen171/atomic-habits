/**
 * Calendar math on local "day keys" (YYYY-MM-DD).
 *
 * Habits live on the user's wall-clock calendar, not in UTC. Every function
 * here works on plain strings so a check-in made at 23:30 never lands on the
 * next day because of a timezone conversion.
 */

export type DayKey = string;
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

export function isDayKey(value: unknown): value is DayKey {
	return typeof value === "string" && DAY_KEY_RE.test(value);
}

/** Local calendar day of a date (defaults to now). */
export function toDayKey(date: Date | number = new Date()): DayKey {
	const d = typeof date === "number" ? new Date(date) : date;
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parts(key: DayKey): [number, number, number] {
	const match = DAY_KEY_RE.exec(key);
	if (!match) throw new Error(`Invalid day key: ${key}`);
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Local midnight of the given day. */
export function parseDayKey(key: DayKey): Date {
	const [y, m, d] = parts(key);
	return new Date(y, m - 1, d);
}

function utcMs(key: DayKey): number {
	const [y, m, d] = parts(key);
	return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): DayKey {
	const d = new Date(ms);
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(key: DayKey, amount: number): DayKey {
	return fromUtcMs(utcMs(key) + amount * MS_PER_DAY);
}

/** Whole days from `b` to `a` (positive when `a` is later). */
export function diffDays(a: DayKey, b: DayKey): number {
	return Math.round((utcMs(a) - utcMs(b)) / MS_PER_DAY);
}

export function weekdayOf(key: DayKey): Weekday {
	return new Date(utcMs(key)).getUTCDay() as Weekday;
}

export function startOfWeek(key: DayKey, weekStartsOn: Weekday = 1): DayKey {
	const offset = (weekdayOf(key) - weekStartsOn + 7) % 7;
	return addDays(key, -offset);
}

export function endOfWeek(key: DayKey, weekStartsOn: Weekday = 1): DayKey {
	return addDays(startOfWeek(key, weekStartsOn), 6);
}

export function startOfMonth(key: DayKey): DayKey {
	const [y, m] = parts(key);
	return `${y}-${pad(m)}-01`;
}

export function daysInMonth(key: DayKey): number {
	const [y, m] = parts(key);
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addMonths(key: DayKey, amount: number): DayKey {
	const [y, m, d] = parts(key);
	const total = y * 12 + (m - 1) + amount;
	const ny = Math.floor(total / 12);
	const nm = (total % 12) + 1;
	const max = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
	return `${ny}-${pad(nm)}-${pad(Math.min(d, max))}`;
}

/** Inclusive list of days between two keys (empty when `to` is before `from`). */
export function eachDay(from: DayKey, to: DayKey): DayKey[] {
	const total = diffDays(to, from);
	const out: DayKey[] = [];
	for (let i = 0; i <= total; i++) out.push(addDays(from, i));
	return out;
}

export function minDay(a: DayKey, b: DayKey): DayKey {
	return a <= b ? a : b;
}

export function maxDay(a: DayKey, b: DayKey): DayKey {
	return a >= b ? a : b;
}

/** Weekdays in display order for a given week start, e.g. [1,2,3,4,5,6,0]. */
export function orderedWeekdays(weekStartsOn: Weekday = 1): Weekday[] {
	return Array.from({ length: 7 }, (_, i) => ((weekStartsOn + i) % 7) as Weekday);
}

/** Days of the week containing `key`, in display order. */
export function weekDays(key: DayKey, weekStartsOn: Weekday = 1): DayKey[] {
	const start = startOfWeek(key, weekStartsOn);
	return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/**
 * Calendar grid for the month containing `key`: full weeks, padded with days
 * from the neighbouring months so every row has seven cells.
 */
export function monthGrid(key: DayKey, weekStartsOn: Weekday = 1): DayKey[][] {
	const first = startOfMonth(key);
	const last = addDays(first, daysInMonth(key) - 1);
	const gridStart = startOfWeek(first, weekStartsOn);
	const gridEnd = endOfWeek(last, weekStartsOn);
	const days = eachDay(gridStart, gridEnd);
	const rows: DayKey[][] = [];
	for (let i = 0; i < days.length; i += 7) rows.push(days.slice(i, i + 7));
	return rows;
}

export function isSameMonth(a: DayKey, b: DayKey): boolean {
	return a.slice(0, 7) === b.slice(0, 7);
}

/** Milliseconds until the next local midnight — used to roll "today" over. */
export function msUntilNextDay(now: Date = new Date()): number {
	const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
	return Math.max(1_000, next.getTime() - now.getTime());
}

/** "HH:MM" → minutes since midnight. */
export function parseTime(value: string | null | undefined): number | null {
	if (!value) return null;
	const match = /^(\d{1,2}):(\d{2})$/.exec(value);
	if (!match) return null;
	const h = Number(match[1]);
	const m = Number(match[2]);
	if (h > 23 || m > 59) return null;
	return h * 60 + m;
}

export function formatTimeValue(minutes: number): string {
	const h = Math.floor(minutes / 60) % 24;
	const m = minutes % 60;
	return `${pad(h)}:${pad(m)}`;
}
