import { describe, expect, it } from "vitest";
import {
	earliestMonthToKeep,
	isMonthExpired,
	keepCurrentIndexEntries,
	monthOfIndexPath,
} from "../../scripts/lib/retention";

const today = new Date(Date.UTC(2026, 9, 23)); // 2026-10-23

const indexEntries = [
	{ id: "melee-3", path: "2026-10/melee-3.json" },
	{ id: "melee-2", path: "2025-11/melee-2.json" },
	{ id: "melee-1", path: "2025-10/melee-1.json" },
];

describe("retention window", () => {
	it("keeps the current month and the eleven months before it", () => {
		expect(earliestMonthToKeep(today, 12)).toBe("2025-11");
	});

	it("keeps the current month only for a window of one", () => {
		expect(earliestMonthToKeep(today, 1)).toBe("2026-10");
	});

	it("counts back over more than one year boundary", () => {
		expect(earliestMonthToKeep(today, 24)).toBe("2024-11");
	});

	it("marks a month before the cutoff as expired", () => {
		expect(isMonthExpired("2025-10", "2025-11")).toBe(true);
		expect(isMonthExpired("2025-11", "2025-11")).toBe(false);
		expect(isMonthExpired("2026-10", "2025-11")).toBe(false);
	});

	it("reads the month from an index path", () => {
		expect(monthOfIndexPath("2026-03/melee-385576.json")).toBe("2026-03");
	});

	it("drops index entries whose month leaves the window", () => {
		const kept = keepCurrentIndexEntries(indexEntries, "2025-11");
		const keptIds = kept.map((entry) => entry.id);
		expect(keptIds).toEqual(["melee-3", "melee-2"]);
	});
});
