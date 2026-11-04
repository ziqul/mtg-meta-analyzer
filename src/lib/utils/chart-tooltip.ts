/**
 * Tooltip placement shared by the metagame charts (scatter + evolution).
 */

import type { ChartType, ScriptableTooltipContext } from "chart.js";

/** Chart.js default gap between the tip of the tooltip arrow and the point. */
const DEFAULT_CARET_PADDING = 2;

/**
 * Tooltip `caretPadding` that puts the tip of the arrow on the edge of the
 * hovered point rather than on its centre. Chart.js resolves it on every
 * tooltip update, so it follows the point under the pointer or the one a
 * legend label activated. The radius is the one of the point's hover style,
 * which is how the point is drawn while its tooltip is open.
 */
export function caretPaddingToPointEdge<TType extends ChartType>({
	tooltip,
}: ScriptableTooltipContext<TType>): number {
	const active = tooltip.getActiveElements()[0];
	if (!active) return DEFAULT_CARET_PADDING;
	const style = tooltip.chart
		.getDatasetMeta(active.datasetIndex)
		.controller.getStyle(active.index, true);
	const radius = Number(style.radius) || 0;
	const borderWidth = Number(style.borderWidth) || 0;
	return radius + borderWidth / 2 + DEFAULT_CARET_PADDING;
}
