/**
 * Retention-window helpers for the data prune.
 *
 * Month directories are named "YYYY-MM", and that name sorts correctly as a
 * string, so the whole rule is one string comparison against a cutoff month.
 */

/** Matches a month directory name, e.g. "2026-03". */
export const MONTH_DIR_PATTERN = /^\d{4}-\d{2}$/;

/**
 * First month that a window of `keepMonths` keeps, as "YYYY-MM".
 * A window of 1 keeps the current month only.
 */
export function earliestMonthToKeep(today: Date, keepMonths: number): string {
	const firstMonthIndex = today.getUTCMonth() - (keepMonths - 1);
	const cutoff = new Date(Date.UTC(today.getUTCFullYear(), firstMonthIndex, 1));
	const year = cutoff.getUTCFullYear();
	const monthNumber = cutoff.getUTCMonth() + 1;
	const month = String(monthNumber).padStart(2, "0");
	return `${year}-${month}`;
}

/** Index entries whose tournament file stays on disk after the prune. */
export function keepCurrentIndexEntries<Entry extends { path: string }>(
	entries: Entry[],
	earliest: string,
): Entry[] {
	return entries.filter((entry) => {
		const month = monthOfIndexPath(entry.path);
		return !isMonthExpired(month, earliest);
	});
}

/** Month part of an index path: "2026-01/melee-1.json" → "2026-01". */
export function monthOfIndexPath(path: string): string {
	const parts = path.split("/");
	return parts[0];
}

/** True when `month` is before the cutoff, and must go. */
export function isMonthExpired(month: string, earliest: string): boolean {
	return month < earliest;
}
