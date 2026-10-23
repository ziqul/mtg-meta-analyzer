/**
 * Draft an archetype config from the MTGGoldfish metagame pages.
 *
 * Step 1: read /metagame/<format> and keep each archetype at or above the
 *         minimum metagame share (default 3%).
 * Step 2: read the /archetype/<slug> page of each one, and keep each mainboard
 *         card at or above the minimum inclusion (default 90% of decks).
 * Step 3: write a YAML config, with minCopies from the average copy count.
 *
 * The result is a DRAFT. Read it before you use it, because:
 *   - The metagame list is the Magic Online view. The paper view needs a POST
 *     with a CSRF token, and the page cache makes that token invalid.
 *   - Basic lands are removed, but a dual land such as "Steam Vents" stays. Its
 *     inclusion is also near 100%, and it says little about the archetype.
 *   - A card name from this site can differ from the name in the tournament
 *     data, for example a two-face card.
 *
 * Usage:
 *   bun run scripts/draft-archetypes-goldfish.ts standard --dry-run
 *   bun run scripts/draft-archetypes-goldfish.ts standard --top 4
 *   bun run scripts/draft-archetypes-goldfish.ts standard --out /tmp/draft.yaml
 *   bun run scripts/draft-archetypes-goldfish.ts modern --min-meta 2 --force
 *
 * `--top N` keeps only the N cards with the highest inclusion. Without it, each
 * card above the inclusion threshold goes into the rule, and a long rule almost
 * never matches, because a rule needs every one of its cards.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "node-html-parser";
import { parseArgValue } from "./lib/cli-utils";

const SITE = "https://www.mtggoldfish.com";
const USER_AGENT = "mtg-meta-analyzer/1.0";
const REQUEST_DELAY_MS = 1000;
const DEFAULT_MIN_META_PERCENT = 3;
const DEFAULT_MIN_INCLUSION_PERCENT = 90;
/** 0 means "keep each card above the inclusion threshold". */
const DEFAULT_TOP_COUNT = 0;
/** The breakdown section that holds sideboard cards, which rules never use. */
const SIDEBOARD_HEADING = "Sideboard";
/**
 * Basic lands never go into a rule. Each deck of a colour plays them, so their
 * inclusion is near 100% and they say nothing about the archetype. The list
 * agrees with scripts/draft-archetypes.ts, with Wastes added.
 */
const BASIC_LANDS = new Set([
	"Plains",
	"Island",
	"Swamp",
	"Mountain",
	"Forest",
	"Wastes",
	"Snow-Covered Plains",
	"Snow-Covered Island",
	"Snow-Covered Swamp",
	"Snow-Covered Mountain",
	"Snow-Covered Forest",
]);

interface Options {
	format: string;
	minMetaPercent: number;
	minInclusionPercent: number;
	topCount: number;
	outPath: string;
	force: boolean;
	dryRun: boolean;
}

interface MetagameTile {
	name: string;
	url: string;
	metaPercent: number;
	deckCount: number;
}

interface SignatureCard {
	name: string;
	minCopies: number;
	inclusionPercent: number;
}

interface DraftArchetype {
	tile: MetagameTile;
	signatureCards: SignatureCard[];
}

async function main(): Promise<void> {
	const options = readOptions(process.argv.slice(2));

	const metagameUrl = `${SITE}/metagame/${options.format}`;
	console.log(`Reading ${metagameUrl}`);
	const metagameHtml = await fetchHtml(metagameUrl);
	const tiles = parseMetagameTiles(metagameHtml, options.minMetaPercent);
	console.log(`Archetypes at or above ${options.minMetaPercent}%: ${tiles.length}`);
	if (tiles.length === 0) {
		throw new Error("No archetype reached the minimum share. Check the format name.");
	}

	const drafts: DraftArchetype[] = [];
	for (const tile of tiles) {
		await sleep(REQUEST_DELAY_MS);
		console.log(`  ${tile.name} (${tile.metaPercent}%) → ${tile.url}`);
		const archetypeHtml = await fetchHtml(tile.url);
		const signatureCards = parseArchetypeCards(
			archetypeHtml,
			options.minInclusionPercent,
			options.topCount,
		);
		if (signatureCards.length === 0) {
			// An empty signatureCards list matches every decklist, because
			// Array.every() is true for an empty array. Such an archetype must
			// never reach the config.
			console.log(`    skipped: no card at or above ${options.minInclusionPercent}%`);
			continue;
		}
		console.log(`    ${signatureCards.length} cards`);
		drafts.push({ tile, signatureCards });
	}

	const yamlText = buildYamlText(options, drafts);
	writeOutput(options, yamlText);
}

function readOptions(args: string[]): Options {
	const format = args.find((arg) => !arg.startsWith("--"));
	if (!format) {
		throw new Error(
			"Usage: bun run scripts/draft-archetypes-goldfish.ts <format> [options]",
		);
	}

	const minMetaValue = parseArgValue(args, "--min-meta");
	let minMetaPercent = DEFAULT_MIN_META_PERCENT;
	if (minMetaValue !== null) {
		minMetaPercent = Number(minMetaValue);
	}

	const minInclusionValue = parseArgValue(args, "--min-inclusion");
	let minInclusionPercent = DEFAULT_MIN_INCLUSION_PERCENT;
	if (minInclusionValue !== null) {
		minInclusionPercent = Number(minInclusionValue);
	}

	if (!Number.isFinite(minMetaPercent) || !Number.isFinite(minInclusionPercent)) {
		throw new Error("--min-meta and --min-inclusion need a number");
	}

	const topValue = parseArgValue(args, "--top");
	let topCount = DEFAULT_TOP_COUNT;
	if (topValue !== null) {
		topCount = Number(topValue);
	}
	if (!Number.isInteger(topCount) || topCount < 0) {
		throw new Error("--top needs a whole number, 0 or above");
	}

	const outValue = parseArgValue(args, "--out");
	let outPath = join("data", "archetypes", `${format}.yaml`);
	if (outValue !== null) {
		outPath = outValue;
	}

	return {
		format,
		minMetaPercent,
		minInclusionPercent,
		topCount,
		outPath,
		force: args.includes("--force"),
		dryRun: args.includes("--dry-run"),
	};
}

async function fetchHtml(url: string): Promise<string> {
	const response = await fetch(url, {
		headers: {
			"User-Agent": USER_AGENT,
			Accept: "text/html",
		},
	});
	if (!response.ok) {
		throw new Error(`GET ${url} answered ${response.status}`);
	}
	return response.text();
}

/** Archetype tiles of the metagame page, above the minimum share. */
function parseMetagameTiles(html: string, minMetaPercent: number): MetagameTile[] {
	const root = parse(html);
	const tiles: MetagameTile[] = [];

	for (const tile of root.querySelectorAll(".archetype-tile")) {
		const link = tile.querySelector(".archetype-tile-title a");
		const statistic = tile.querySelector(
			".metagame-percentage .archetype-tile-statistic-value",
		);
		if (!link || !statistic) {
			continue;
		}

		const href = link.getAttribute("href") ?? "";
		const path = href.split("#")[0];
		if (path === "") {
			continue;
		}

		const share = parseMetaShare(statistic.text);
		if (share === null || share.metaPercent < minMetaPercent) {
			continue;
		}

		tiles.push({
			name: link.text.trim(),
			url: `${SITE}${path}`,
			metaPercent: share.metaPercent,
			deckCount: share.deckCount,
		});
	}

	return tiles;
}

/** Reads the tile statistic "10.7% (139)". */
function parseMetaShare(text: string): { metaPercent: number; deckCount: number } | null {
	const match = text.trim().match(/([0-9.]+)%\s*\(([0-9]+)\)/);
	if (!match) {
		return null;
	}
	return {
		metaPercent: Number(match[1]),
		deckCount: Number(match[2]),
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/** Mainboard cards of the Card Breakdown section, above the minimum inclusion. */
function parseArchetypeCards(
	html: string,
	minInclusionPercent: number,
	topCount: number,
): SignatureCard[] {
	const root = parse(html);
	const cards: SignatureCard[] = [];

	const containers = root.querySelectorAll(
		".deck-archetype-breakdown .spoiler-card-container",
	);
	for (const container of containers) {
		const heading = container.querySelector("h3")?.text.trim() ?? "";
		if (heading === SIDEBOARD_HEADING) {
			continue;
		}

		for (const card of container.querySelectorAll(".spoiler-card")) {
			const name = card.querySelector(".price-card-invisible-label")?.text.trim();
			const text = card
				.querySelector(".archetype-breakdown-featured-card-text")
				?.text.trim();
			if (!name || !text) {
				continue;
			}
			if (BASIC_LANDS.has(name)) {
				continue;
			}

			const inclusion = parseInclusion(text);
			if (inclusion === null) {
				continue;
			}
			if (inclusion.inclusionPercent < minInclusionPercent) {
				continue;
			}

			const roundedCopies = Math.round(inclusion.averageCopies);
			const minCopies = Math.max(1, roundedCopies);
			cards.push({
				name,
				minCopies,
				inclusionPercent: inclusion.inclusionPercent,
			});
		}
	}

	return pickTopCards(cards, topCount);
}

/** Reads the card text "4.0 in 100% of decks". */
function parseInclusion(
	text: string,
): { averageCopies: number; inclusionPercent: number } | null {
	const match = text.match(/([0-9.]+)\s+in\s+([0-9.]+)%/);
	if (!match) {
		return null;
	}
	return {
		averageCopies: Number(match[1]),
		inclusionPercent: Number(match[2]),
	};
}

/**
 * Sorts by inclusion, highest first, and keeps `topCount` cards. A topCount of
 * 0 keeps them all. Equal inclusion sorts by copy count, then by name, so that
 * two runs of the same data give the same file.
 */
function pickTopCards(cards: SignatureCard[], topCount: number): SignatureCard[] {
	const sorted = [...cards];
	sorted.sort((left, right) => {
		if (left.inclusionPercent !== right.inclusionPercent) {
			return right.inclusionPercent - left.inclusionPercent;
		}
		if (left.minCopies !== right.minCopies) {
			return right.minCopies - left.minCopies;
		}
		return left.name.localeCompare(right.name);
	});

	if (topCount === 0) {
		return sorted;
	}
	return sorted.slice(0, topCount);
}

function buildYamlText(options: Options, drafts: DraftArchetype[]): string {
	const today = new Date().toISOString().slice(0, 10);
	const lines: string[] = [];

	lines.push(`format: ${toDisplayFormat(options.format)}`);
	lines.push(`date: "${today}"`);
	let topNote = "all cards";
	if (options.topCount > 0) {
		topNote = `top ${options.topCount} cards`;
	}
	lines.push(
		`# Draft from ${SITE}/metagame/${options.format}` +
			` — share >= ${options.minMetaPercent}%,` +
			` inclusion >= ${options.minInclusionPercent}%, ${topNote}`,
	);
	lines.push("archetypes:");

	for (const draft of drafts) {
		lines.push(`  - name: ${JSON.stringify(draft.tile.name)}`);
		lines.push(
			`    # ${draft.tile.metaPercent}% of the metagame,` +
				` ${draft.tile.deckCount} decks`,
		);
		lines.push("    signatureCards:");
		for (const card of draft.signatureCards) {
			lines.push(`      - name: ${JSON.stringify(card.name)}`);
			lines.push(`        minCopies: ${card.minCopies}`);
			lines.push(`        # in ${card.inclusionPercent}% of decks`);
		}
	}

	return `${lines.join("\n")}\n`;
}

/** Format slug → display name, e.g. "duel-commander" → "Duel Commander". */
function toDisplayFormat(slug: string): string {
	const words = slug.split("-");
	const capitalized: string[] = [];
	for (const word of words) {
		if (word.length === 0) {
			continue;
		}
		capitalized.push(word[0].toUpperCase() + word.slice(1));
	}
	return capitalized.join(" ");
}

function writeOutput(options: Options, yamlText: string): void {
	if (options.dryRun) {
		console.log(`\n--- ${options.outPath} (dry run, nothing written) ---\n`);
		console.log(yamlText);
		return;
	}

	if (existsSync(options.outPath)) {
		if (!options.force) {
			throw new Error(
				`${options.outPath} exists. It can hold manual work such as strictMode` +
					" and exactCopies. Use --out with another path, or --force to overwrite.",
			);
		}

		const oldText = readFileSync(options.outPath, "utf-8");
		if (isSameExceptDate(oldText, yamlText)) {
			console.log(`${options.outPath} is already current`);
			return;
		}
	}

	writeFileSync(options.outPath, yamlText);
	console.log(`Written to ${options.outPath}`);
}

/**
 * Compares two configs and ignores the date line. The date is today for each
 * run, so without this test a daily job would commit a new file each day, also
 * when no archetype and no card changed.
 */
function isSameExceptDate(left: string, right: string): boolean {
	const leftBody = withoutDateLine(left);
	const rightBody = withoutDateLine(right);
	return leftBody === rightBody;
}

function withoutDateLine(text: string): string {
	const lines = text.split("\n");
	const kept: string[] = [];
	for (const line of lines) {
		if (line.startsWith("date:")) {
			continue;
		}
		kept.push(line);
	}
	return kept.join("\n");
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		if (error instanceof Error) {
			console.error(error.message);
		} else {
			console.error(error);
		}
		process.exitCode = 1;
	});
}
