/**
 * Delete tournament data outside the retention window, and drop the matching
 * entries from each per-format index.json.
 *
 * The build publishes data/ as static assets, and a GitHub Pages site must stay
 * below 1 GB, so the daily fetch workflows run this to hold the size steady.
 * Card image entries are left alone: a name that no tournament needs any more
 * is harmless, and a rewrite of card-images.json would add 2.8 MB of churn.
 *
 * Usage:
 *   bun run scripts/prune-old-data.ts
 *   bun run scripts/prune-old-data.ts --keep-months 18
 *   bun run scripts/prune-old-data.ts --dry-run
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TournamentIndexEntry } from "../src/lib/types/tournament";
import { parseArgValue } from "./lib/cli-utils";
import {
	earliestMonthToKeep,
	isMonthExpired,
	keepCurrentIndexEntries,
	MONTH_DIR_PATTERN,
} from "./lib/retention";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "data");
const DEFAULT_KEEP_MONTHS = 12;
/** Holds classification rules, not tournaments, so the prune skips it. */
const NON_FORMAT_DIRS = new Set(["archetypes"]);

interface IndexPruneCounts {
	before: number;
	after: number;
}

function main(): void {
	const args = process.argv.slice(2);
	const keepMonths = readKeepMonths(args);
	const dryRun = args.includes("--dry-run");
	const earliest = earliestMonthToKeep(new Date(), keepMonths);

	let mode = "";
	if (dryRun) {
		mode = " (dry run)";
	}
	console.log(`Retention: ${keepMonths} months, keep ${earliest} and later${mode}`);

	let removedMonths = 0;
	let removedFiles = 0;

	for (const formatSlug of listFormatDirs()) {
		const formatDir = join(DATA_DIR, formatSlug);
		const expiredMonths = listExpiredMonthDirs(formatDir, earliest);
		if (expiredMonths.length === 0) {
			continue;
		}

		for (const month of expiredMonths) {
			const monthDir = join(formatDir, month);
			const fileCount = countJsonFiles(monthDir);
			if (!dryRun) {
				rmSync(monthDir, { recursive: true, force: true });
			}
			removedMonths += 1;
			removedFiles += fileCount;
			console.log(`  ${formatSlug}/${month}: ${fileCount} files`);
		}

		const counts = pruneFormatIndex(formatSlug, earliest, dryRun);
		const indexReport = `${counts.before} -> ${counts.after} entries`;
		console.log(`  ${formatSlug}/index.json: ${indexReport}`);
	}

	if (removedMonths === 0) {
		console.log("Nothing to prune.");
		return;
	}
	console.log(`Pruned ${removedFiles} files in ${removedMonths} month directories.`);
}

function readKeepMonths(args: string[]): number {
	const value = parseArgValue(args, "--keep-months");
	if (value === null) {
		return DEFAULT_KEEP_MONTHS;
	}
	const months = Number(value);
	if (!Number.isInteger(months) || months < 1) {
		throw new Error(`--keep-months needs a whole number above 0, got "${value}"`);
	}
	return months;
}

function listFormatDirs(): string[] {
	const entries = readdirSync(DATA_DIR, { withFileTypes: true });
	const names: string[] = [];
	for (const entry of entries) {
		if (entry.isDirectory() && !NON_FORMAT_DIRS.has(entry.name)) {
			names.push(entry.name);
		}
	}
	names.sort();
	return names;
}

function listExpiredMonthDirs(formatDir: string, earliest: string): string[] {
	const entries = readdirSync(formatDir, { withFileTypes: true });
	const months: string[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || !MONTH_DIR_PATTERN.test(entry.name)) {
			continue;
		}
		if (isMonthExpired(entry.name, earliest)) {
			months.push(entry.name);
		}
	}
	months.sort();
	return months;
}

function countJsonFiles(dir: string): number {
	const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
	return files.length;
}

/** Rewrites one index.json without the expired entries. */
function pruneFormatIndex(
	formatSlug: string,
	earliest: string,
	dryRun: boolean,
): IndexPruneCounts {
	const indexPath = join(DATA_DIR, formatSlug, "index.json");
	if (!existsSync(indexPath)) {
		return { before: 0, after: 0 };
	}
	const entries: TournamentIndexEntry[] = JSON.parse(readFileSync(indexPath, "utf-8"));
	const kept = keepCurrentIndexEntries(entries, earliest);
	if (!dryRun && kept.length !== entries.length) {
		writeFileSync(indexPath, JSON.stringify(kept, null, 2));
	}
	return { before: entries.length, after: kept.length };
}

if (import.meta.main) {
	try {
		main();
	} catch (error: unknown) {
		if (error instanceof Error) {
			console.error(error.message);
		} else {
			console.error(error);
		}
		process.exitCode = 1;
	}
}
